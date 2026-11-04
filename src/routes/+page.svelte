<script lang="ts">
	import { onMount } from 'svelte';
	import SignIn from '$lib/components/SignIn.svelte';
	import LoadingScreen from '$lib/components/LoadingScreen.svelte';
	import TriageScreen from '$lib/components/TriageScreen.svelte';
	import ReviewScreen from '$lib/components/ReviewScreen.svelte';
	import RunScreen from '$lib/components/RunScreen.svelte';
	import SettingsScreen from '$lib/components/SettingsScreen.svelte';
	import KeptScreen from '$lib/components/KeptScreen.svelte';
	import CostNote from '$lib/components/CostNote.svelte';
	import CostScreen from '$lib/components/CostScreen.svelte';
	import NetworkScreen from '$lib/components/NetworkScreen.svelte';
	import AppChrome from '$lib/components/AppChrome.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { exact } from '$lib/format';
	import { TriageSession } from '$lib/triage/session.svelte';

	const session = new TriageSession();

	// IndexedDB and sessionStorage exist only in the browser, and the app is
	// client-rendered, so restoring waits for mount rather than running in load.
	onMount(() => {
		session.restore();
	});
</script>

<AppChrome {session} />

<main>
	{#if session.phase === 'signed-out' || session.phase === 'signing-in'}
		<SignIn
			busy={session.phase === 'signing-in'}
			error={session.error}
			onSignIn={(handle) => session.signIn(handle)}
		/>
	{:else if session.phase === 'loading'}
		<LoadingScreen progress={session.progress} />
	{:else}
		<!--
			A run that never finished deleted records and stopped saying so. It
			outranks whatever screen would otherwise be here, because it is the
			one state the user cannot see from the queue.
		-->
		{#if session.runs.unfinished && session.phase !== 'running'}
			<div class="interrupted" role="alert">
				<p class="u:fs-1">
					A previous unfollow run did not finish. Resuming re-reads your repo first, so nothing is
					deleted twice.
				</p>
				<Button onclick={() => session.resumeRun()}>Resume the run</Button>
			</div>
		{/if}

		{#if session.phase === 'triage'}
			<TriageScreen {session} />
		{:else if session.phase === 'review'}
			<ReviewScreen {session} />
		{:else if session.phase === 'running'}
			<RunScreen {session} />
		{:else if session.phase === 'settings'}
			<SettingsScreen {session} />
		{:else if session.phase === 'kept'}
			<KeptScreen {session} />
		{:else if session.phase === 'cost'}
			<CostScreen {session} />
		{:else if session.phase === 'network'}
			<NetworkScreen {session} />
		{:else}
			<section class="[ done ] [ l:stage ]">
				<h1 class="u:fs-5">
					{session.skippedCount > 0 ? 'Only skipped accounts left' : 'Every account reviewed'}
				</h1>
				<p class="u:fs-2 tabular">
					{exact(session.keptCount)} kept · {exact(session.markedCount)} marked for unfollow
				</p>

				<div class="actions">
					{#if session.markedCount > 0}
						<Button onclick={() => session.review()}>
							Review {exact(session.markedCount)} marked
						</Button>
					{/if}
					{#if session.skippedCount > 0}
						<Button data-variant="quiet" onclick={() => session.reviewSkipped()}>
							Go back to {exact(session.skippedCount)} skipped
						</Button>
					{/if}
					{#if session.keptCount > 0}
						<Button data-variant="quiet" onclick={() => session.showKept()}>
							See {exact(session.keptCount)} kept
						</Button>
					{/if}
				</div>

				<CostNote counts={session.meter.counts} onexplain={() => session.showCost()} />
			</section>
		{/if}
	{/if}
</main>

<style>
	@layer layout {
		.done {
			display: flex;
			flex-direction: column;
			align-items: flex-start;
			gap: var(--space-sm);
			--stage-width: 44rem;
			--stage-leading: var(--space-4xl);
		}

		h1,
		p {
			margin: 0;
		}

		.actions {
			display: flex;
			flex-wrap: wrap;
			gap: var(--space-sm);
			margin-block-start: var(--space-lg);
		}

		.interrupted {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--space-lg);
			background-color: var(--chip-bg);
			padding: var(--space-sm) var(--space-lg) var(--space-sm) var(--space-2xl);
		}

		.interrupted :global(.button) {
			min-block-size: var(--tap-min);
		}

		/* phone — see the breakpoint note in src/lib/styles/tokens.css */
		@media (max-width: 40rem) {
			/*
			 * Clearance for the fixed band the chrome lays down at this width,
			 * declared once for the whole page rather than by each screen.
			 * Every screen would otherwise have to know the band exists, and
			 * the one that forgot would put its first line underneath it.
			 */
			main {
				padding-block-start: var(--top-band);
			}

			.interrupted {
				padding-inline: var(--space-lg);
			}
		}

		.interrupted p {
			font-family: var(--ff-ui);
			color: var(--chip-ink);
		}

		.actions :global(.button[data-variant='quiet']) {
			background-color: transparent;
			color: var(--ink-quiet);
			border: 1px solid var(--hue-z0-divider);
		}

		.actions :global(.button[data-variant='quiet']:hover:not(:disabled)) {
			color: var(--ink);
		}
	}
</style>
