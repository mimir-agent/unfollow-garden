<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import type { TriageSession } from '$lib/triage/session.svelte';

	/**
	 * The page furniture that sits outside the reading column: the wordmark on
	 * one edge and the utility links on the other.
	 *
	 * Its own component rather than markup in `+page.svelte` because the route
	 * builds its own `TriageSession`, which leaves anything written there
	 * impossible to mount in a test or a story. Taking the session as a prop is
	 * what makes the chrome checkable at all — and this is the part of the app
	 * that is on screen in every phase.
	 *
	 * It also puts the two fixed elements in one file, which is what lets the
	 * stacking order between them be stated once instead of depending on source
	 * order across two components.
	 */
	let { session }: { session: TriageSession } = $props();

	/*
	 * Before sign-in there is no card to go back to, and a run in flight is not
	 * somewhere to navigate away from mid-delete. In both, the wordmark is a
	 * plain span: inert markup exactly when the action would be inert, rather
	 * than a button that silently does nothing.
	 */
	const inert = $derived(
		session.phase === 'signed-out' || session.phase === 'signing-in' || session.phase === 'running'
	);

	/* Settings is reachable from every screen except a run in flight, where
	   changing the lookback mid-delete would be nobody's intention. */
	const showUtility = $derived(session.phase !== 'settings' && session.phase !== 'running');
	const signedIn = $derived(session.phase !== 'signed-out' && session.phase !== 'signing-in');
</script>

<!--
	The wordmark is a tab on the page edge rather than a header bar. This app is
	one long screen the user reads top to bottom several hundred times, and a
	horizontal header would cost that screen a band of height on every one of
	them.

	It is a button, not a link: on a single-route app "home" is a phase change,
	and an `<a href="/">` would be a no-op.
-->
{#if inert}
	<span class="wordmark">unfollow.garden</span>
{:else}
	<Button class="wordmark" data-variant="link" onclick={() => session.home()}>
		unfollow.garden
	</Button>
{/if}

{#if signedIn && showUtility}
	<div class="[ utility ] [ l:stage ]">
		<!--
			Starting the review again is a normal thing to want after a sitting,
			and it was reachable only from inside settings, next to the button
			that erases the account. Two different actions filed under one
			heading, and the milder one was the one you had to go looking for.
		-->
		<div class="reset">
			<ConfirmAction
				label="Start over"
				confirmLabel="Clear every decision"
				onconfirm={() => session.resetDecisions()}
			/>
		</div>
		<!--
			Hidden while the follow list loads, when there is nothing to count
			and leaving would break the load. On its own screen it is plain
			text, for the same reason the wordmark is: inert exactly when the
			action would be.
		-->
		{#if session.phase === 'network'}
			<span class="current" aria-current="page">Follows</span>
		{:else if session.phase !== 'loading'}
			<Button data-variant="link" onclick={() => session.showNetwork()}>Follows</Button>
		{/if}
		<Button data-variant="link" onclick={() => session.openSettings()}>Settings</Button>
		<Button data-variant="link" onclick={() => session.signOut()}>Sign out</Button>
	</div>
{/if}

<style>
	@layer layout {
		.wordmark,
		:global(.button.wordmark) {
			position: fixed;
			top: 0;
			left: 0;
			z-index: var(--layer-tab);

			writing-mode: vertical-rl;
			padding: var(--space-lg) var(--space-2xs);
			border: none;
			/*
			 * `.button` floors its block size at `--tap-min`. In vertical
			 * writing the block axis runs across the page, so inheriting that
			 * floor would widen this tab into a 2.75rem gutter. The tab's
			 * measurements are the established visual contract, and the element
			 * becoming interactive is not a reason to change them.
			 *
			 * It does leave the tab narrower than the 24px WCAG 2.5.8 target
			 * minimum on a pointer device. Widening it is a call about the
			 * wordmark's proportions, which is not this change's to make.
			 */
			min-block-size: auto;
			/*
			 * `.button` also brings a radius and 600 weight. The tab is a
			 * square-cornered edge marker in the app's own voice, and becoming
			 * interactive is not a reason for it to start looking like a
			 * button, so both are put back.
			 */
			border-radius: 0;
			font-weight: normal;

			font-family: var(--ff-ui);
			font-size: var(--fs-0);
			letter-spacing: 0.08em;
			text-decoration: none;

			background-color: var(--chip-bg);
			color: var(--chip-ink);
		}

		:global(.button.wordmark:hover) {
			text-decoration: underline;
		}

		/*
		 * Pinned to the top, and ending where the content ends.
		 *
		 * The bar spans the viewport and carries the reading column's own
		 * ceiling and end padding, so its last link lands on the same edge as
		 * the text below it. Pinning to `right: 0` instead put the links
		 * against the window on a wide screen, hundreds of pixels adrift of
		 * everything they sit above.
		 *
		 * Centred the same way the stage is — `inset-inline: 0` with an auto
		 * margin — rather than by arithmetic on `100vw`, which counts the
		 * scrollbar the stage does not.
		 */
		.utility {
			position: fixed;
			top: 0;
			inset-inline: 0;
			/*
			 * `l:stage` supplies the ceiling, the centring, and the inline
			 * padding, so the last link lands on the same edge as the text
			 * below it and cannot drift from it later. Only the block padding
			 * is this bar's own — a fixed strip wants none of the reading
			 * column's leading.
			 */
			padding-block: var(--space-xl) var(--space-sm);
			/*
			 * Above the wordmark tab, not level with it. On a phone the two
			 * share one band and these links sit over its right end.
			 */
			z-index: var(--layer-bar);
			display: flex;
			justify-content: flex-end;
			align-items: center;
			gap: var(--space-lg);
			/*
			 * The bar is now as wide as the page, so only the links themselves
			 * may take a click — otherwise an invisible strip would sit over
			 * the top of every screen and swallow them.
			 */
			pointer-events: none;
		}

		.utility > :global(*) {
			pointer-events: auto;
		}

		.utility :global(.button[data-variant='link']) {
			background: transparent;
			color: var(--ink-quiet);
			font-family: var(--ff-ui);
			font-size: var(--fs-0);
			padding: 0;
		}

		.utility :global(.button[data-variant='link']:hover) {
			color: var(--ink);
			text-decoration: underline;
		}

		/*
		 * Matched to the buttons beside it. A bare span would come out lighter,
		 * and with the body's line height it sits half a pixel above them.
		 */
		.current {
			font-family: var(--ff-ui);
			font-size: var(--fs-0);
			font-weight: 600;
			line-height: 1;
			color: var(--ink);
		}

		/*
		 * At rest the reset is a peer of the other two links and carries no
		 * more weight than they do. Once armed it stops being a link: the
		 * confirming button keeps its full destructive styling, because at that
		 * point it is one click from clearing every decision made.
		 */
		.reset :global(.button[data-variant='quiet']) {
			background: transparent;
			border: none;
			color: var(--ink-quiet);
			font-family: var(--ff-ui);
			font-size: var(--fs-0);
			padding: 0;
		}

		.reset :global(.button[data-variant='quiet']:hover) {
			color: var(--ink);
			text-decoration: underline;
		}

		/* phone — see the breakpoint note in src/lib/styles/tokens.css */
		@media (max-width: 40rem) {
			/*
			 * On a phone the edge tab would eat a gutter the content cannot
			 * spare, so it lies down into a band across the top.
			 *
			 * The band stays *fixed* rather than going static: the utility
			 * links opposite it are fixed too, and a static band would scroll
			 * out from under them and leave them floating over the card. Both
			 * keep the same block padding so they read as one bar.
			 */
			.wordmark,
			:global(.button.wordmark) {
				writing-mode: horizontal-tb;
				display: flex;
				align-items: center;
				justify-content: flex-start;
				inset-inline: 0;
				block-size: var(--top-band);
				/* Horizontal again, so the floor means height and the
				   full-width band already clears it. */
				min-block-size: var(--top-band);
				padding: 0 var(--space-lg);
			}

			/* The right-hand end of the wordmark's band, so it inherits its ink. */
			.utility {
				block-size: var(--top-band);
				padding-block: 0;
				padding-inline: var(--space-lg);
				/*
				 * Four controls share the band now, so the gap tightens rather
				 * than letting the row wrap out of a fixed-height band and
				 * disappear behind the card.
				 */
				gap: var(--space-medium);
			}

			.utility :global(.button[data-variant='link']),
			.reset :global(.button[data-variant='quiet']),
			.current {
				color: var(--chip-ink);
			}

			/*
			 * Armed, the two buttons are taller than the band and wider than
			 * what is left of it, so they drop underneath it instead.
			 *
			 * They are not shrunk to fit: `--tap-min` is fixed rather than a
			 * fluid `--space-*` step precisely so a finger keeps its room on
			 * the narrowest screens, and the button that clears every decision
			 * is the last one to compromise on being hit accurately.
			 */
			.reset :global(.row[data-armed='true']) {
				position: absolute;
				top: 100%;
				right: 0;
				padding: var(--space-sm) var(--space-lg);
				background-color: var(--chip-bg);
			}
		}
	}
</style>
