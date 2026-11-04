<script lang="ts">
	import { RadioGroup } from 'bits-ui';
	import Button from '$lib/components/ui/Button.svelte';
	import BackLink from '$lib/components/BackLink.svelte';
	import { identityLink } from '$lib/atproto/links';
	import { duration, exact, longDate } from '$lib/format';
	import { isOffered, PERIODS, type Period } from '$lib/stats/network-stats';
	import type { TriageSession } from '$lib/triage/session.svelte';

	let { session }: { session: TriageSession } = $props();

	/*
	 * While the scan runs, the figures catch up once a second rather than on
	 * every account it lands. They jump rather than animate: the status line
	 * already says they are moving.
	 *
	 * `pre`, so the refresh on opening lands before the first render reads
	 * the figures, rather than computing them twice.
	 */
	$effect.pre(() => {
		session.refreshNetwork();
		if (!session.scanner.running) return;
		const timer = setInterval(() => session.refreshNetwork(), 1000);
		return () => clearInterval(timer);
	});

	const stats = $derived(session.network);
	const lookbackDays = $derived(session.settings.lookbackDays);

	const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

	/** A rounded share must not say "nobody" or "everyone" when that is false. */
	function share(part: number, whole: number): string {
		const percent = Math.round((part / whole) * 100);
		if (percent === 0 && part > 0) return 'under 1%';
		if (percent === 100 && part < whole) return 'over 99%';
		return `${percent}%`;
	}

	function perDay(value: number): string {
		if (value > 0 && value < 0.05) return 'under 0.1';
		return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
	}

	const percentChange = new Intl.NumberFormat(undefined, {
		style: 'percent',
		signDisplay: 'exceptZero',
		maximumFractionDigits: 0
	});

	/*
	 * A true minus rather than a hyphen. In tabular figures `+` and `−` are the
	 * same width and `-` is narrower, so a hyphen makes a fall look lighter
	 * than a rise of the same size.
	 */
	const signed = (change: number) => percentChange.format(change).replace('-', '\u2212');
</script>

<section class="[ network ] [ l:stage ]">
	<BackLink onback={() => session.backToTriage()} />

	{#if stats === null}
		<header>
			<h1 class="u:fs-5">Not enough history to compare</h1>
			<p class="lede u:fs-2 u:lh-standard">
				To compare 7 days, load at least 14 days of history in <Button
					data-variant="link"
					onclick={() => session.openSettings()}>Settings</Button
				>.
			</p>
		</header>
	{:else}
		{@const period = stats.period}
		{@const series = stats.series}
		{@const tallest = Math.max(...series.prior, ...series.current)}
		{@const mark = duration(series.bucketDays)}
		<header>
			{#if stats.counted === 0}
				<h1 class="u:fs-5">
					{stats.notCounted.loading > 0 ? 'Nothing to count yet' : 'Nothing to count'}
				</h1>
				<p class="lede u:fs-2 u:lh-standard">
					{#if stats.followed === 0}
						You do not follow any accounts yet, so there is nothing to count.
					{:else if stats.notCounted.loading > 0}
						No account's activity has loaded yet, so there is nothing to count. Figures appear here
						as it loads.
					{:else}
						No account you follow could be counted. The lines below say why.
					{/if}
				</p>
			{:else}
				<h1 class="[ u:fs-5 ] [ tabular ]">
					{exact(stats.posted)} of {exact(stats.counted)}
					{plural(stats.counted, 'account', 'accounts')} posted in the last {period} days
				</h1>
				<p class="lede u:fs-2 u:lh-standard tabular">
					That is {share(stats.posted, stats.counted)} of the accounts you follow{stats.counted <
					stats.followed
						? ' whose activity has loaded'
						: ''}.
				</p>
			{/if}

			{#if stats.notCounted.loading + stats.notCounted.failed + stats.notCounted.unavailable > 0}
				<div class="not-counted">
					{#if stats.notCounted.loading > 0}
						<p class="u:fs-0 tabular" role="status">
							{session.scanner.waitingOnRateLimit
								? 'Waiting out a rate limit.'
								: `Still loading activity for ${exact(stats.notCounted.loading)} ${plural(stats.notCounted.loading, 'account', 'accounts')}.`}
							These figures are based on {exact(stats.counted)} of {exact(stats.followed)}.
						</p>
					{/if}
					{#if stats.notCounted.failed === 1}
						<p class="u:fs-0 tabular">
							Activity could not be loaded for 1 account, so it is not counted. Reloading the page
							tries it again.
						</p>
					{:else if stats.notCounted.failed > 1}
						<p class="u:fs-0 tabular">
							Activity could not be loaded for {exact(stats.notCounted.failed)} accounts, so they are
							not counted. Reloading the page tries them again.
						</p>
					{/if}
					{#if stats.notCounted.unavailable === 1}
						<p class="u:fs-0 tabular">
							1 account has no profile, so it is not counted. It may be deleted, deactivated, or
							suspended.
						</p>
					{:else if stats.notCounted.unavailable > 1}
						<p class="u:fs-0 tabular">
							{exact(stats.notCounted.unavailable)} accounts have no profile, so they are not counted.
							They may be deleted, deactivated, or suspended.
						</p>
					{/if}
				</div>
			{/if}
		</header>

		<div class="period-group">
			<div class="picker">
				<span id="network-period" class="picker-label u:fs-1">Compare the last</span>
				<RadioGroup.Root
					class="periods"
					orientation="horizontal"
					aria-labelledby="network-period"
					bind:value={
						() => String(period), (value) => (session.networkPeriodChosen = Number(value) as Period)
					}
				>
					{#each PERIODS as days (days)}
						<RadioGroup.Item
							class="[ period ] [ u:fs-1 ]"
							value={String(days)}
							disabled={!isOffered(days, lookbackDays)}
						>
							{days} days
						</RadioGroup.Item>
					{/each}
				</RadioGroup.Root>
			</div>
			<!-- Straight after the group, so a screen reader meets the reason next. -->
			{#if !isOffered(30, lookbackDays)}
				<p class="caption u:fs-0">
					To compare 30 days, load at least 60 days of history in <Button
						data-variant="link"
						onclick={() => session.openSettings()}>Settings</Button
					>, or 180 for 90 days.
				</p>
			{:else if !isOffered(90, lookbackDays)}
				<p class="caption u:fs-0">
					To compare 90 days, load at least 180 days of history in <Button
						data-variant="link"
						onclick={() => session.openSettings()}>Settings</Button
					>.
				</p>
			{/if}
		</div>

		{#if stats.counted > 0}
			<div class="compare">
				{#if stats.compared === 0}
					<p class="empty u:fs-1">
						No account's posts and likes both load back the full {2 * period} days, so there is nothing
						to compare.
					</p>
				{:else}
					<dl class="figures tabular">
						<div>
							<dd>{perDay(stats.perDay.current)}</dd>
							<dt>Posts a day, last {period} days</dt>
						</div>
						<div>
							<dd>{perDay(stats.perDay.prior)}</dd>
							<dt>Posts a day, {period} days before</dt>
						</div>
						{#if stats.change !== null}
							<div>
								<dd>{signed(stats.change)}</dd>
								<dt>Change</dt>
							</div>
						{/if}
					</dl>
					{#if stats.change === null}
						<p class="caption u:fs-0">
							No posts in the {period} days before, so there is no change to show.
						</p>
					{/if}

					<!-- The series: the account card's timeline buckets, with a fill level added. -->
					<div
						class="series"
						role="img"
						aria-label={`${exact(stats.posts.prior)} ${plural(stats.posts.prior, 'post', 'posts')} in the ${period} days before and ${exact(stats.posts.current)} in the last ${period} days, one mark per ${mark}`}
						style="--bucket-count: {series.prior.length}"
					>
						{#each [{ half: 'prior', counts: series.prior, label: `${period} days before` }, { half: 'current', counts: series.current, label: `Last ${period} days` }] as { half, counts, label } (half)}
							<div class="half" data-period={half} aria-hidden="true">
								<div class="track">
									{#each counts as count, index (index)}
										<span class="bucket">
											{#if count > 0}
												<span class="fill" style="--fill: {count / tallest}"></span>
											{/if}
										</span>
									{/each}
								</div>
								<span class="label u:fs-0">{label}</span>
							</div>
						{/each}
					</div>
				{/if}

				<div class="captions">
					{#if stats.compared > 0}
						<p class="u:fs-0 tabular">
							Each mark is {mark}. The first half is the {period} days before.
						</p>
						<p class="u:fs-0 tabular">
							Across {exact(stats.compared)}
							{plural(stats.compared, 'account', 'accounts')}.
						</p>
					{/if}
					{#if stats.fetchLimited === 1}
						<p class="u:fs-0 tabular">
							1 account posts or likes more than the app loads, so not all of its posts and likes
							from the last {2 * period} days are loaded. It is left out of this comparison.
						</p>
					{:else if stats.fetchLimited > 1}
						<p class="u:fs-0 tabular">
							{exact(stats.fetchLimited)} accounts post or like more than the app loads, so not all of
							their posts and likes from the last {2 * period} days are loaded. They are left out of this
							comparison.
						</p>
					{/if}
				</div>
			</div>

			<section class="quiet">
				{#if stats.quiet.length > 0}
					<h2 class="u:fs-2 tabular">
						{exact(stats.quiet.length)}
						{plural(stats.quiet.length, 'account', 'accounts')} posted in the {period} days before, but
						not in the last {period}
					</h2>
					<ul>
						{#each stats.quiet as row (row.subject.subjectDid)}
							{@const link = identityLink(
								row.subject.profile,
								row.subject.subjectDid,
								session.settings.linkClient
							)}
							<li>
								<div class="who">
									<span class="name u:fs-2">
										{row.subject.profile?.displayName || row.subject.profile?.handle}
									</span>
									<a
										class="handle u:fs-0"
										data-kind={link.kind}
										href={link.href}
										target="_blank"
										rel="external noreferrer noopener">{link.label}</a
									>
								</div>
								<p class="when u:fs-0 tabular">
									<span>
										{exact(row.priorPosts)}
										{plural(row.priorPosts, 'post', 'posts')} in the {period} days before
									</span>
									<span aria-hidden="true">·</span>
									<span>
										last posted <time datetime={row.lastPostAt}>{longDate(row.lastPostAt)}</time>
									</span>
								</p>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="empty u:fs-1" role="status">
						{stats.postedBefore === 0
							? `No account posted in the ${period} days before.`
							: `Every account that posted in the ${period} days before also posted in the last ${period}.`}
					</p>
				{/if}
			</section>

			<div class="notes u:fs-0 u:lh-standard">
				<p>
					Posts here include replies and reposts. Likes are not counted: they do not appear in your
					timeline, and some accounts' likes cannot be loaded at all.
				</p>
				<p>
					Both periods count the accounts you follow now, so the {period} days before includes accounts
					you had not followed yet and leaves out ones you have since unfollowed.
				</p>
			</div>
		{/if}
	{/if}
</section>

<style>
	@layer layout {
		/* Five groups, like settings, so it takes settings' wider rhythm. */
		.network {
			display: flex;
			flex-direction: column;
			gap: var(--space-2xl);
			--stage-width: 48rem;
		}

		/* Breaks the headline after "posted in" rather than leaving "days" alone. */
		h1 {
			margin: 0;
			max-inline-size: 24ch;
		}

		.lede {
			margin: var(--space-sm) 0 0;
			max-inline-size: 60ch;
			color: var(--ink-quiet);
		}

		/*
		 * Where the accounts that are not counted went. These are ordinary
		 * states rather than warnings, so they are quiet ink and not amber.
		 */
		.not-counted {
			display: flex;
			flex-direction: column;
			gap: var(--space-2xs);
			margin-block-start: var(--space-lg);
		}

		.not-counted p,
		.caption,
		.captions p {
			margin: 0;
			font-family: var(--ff-ui);
			color: var(--ink-quiet);
			max-inline-size: 60ch;
		}

		.period-group {
			display: flex;
			flex-direction: column;
			gap: var(--space-sm);
		}

		/* One line that reads as a phrase; on a phone the label wraps above by itself. */
		.picker {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--space-sm) var(--space-lg);
		}

		.picker-label {
			font-family: var(--ff-ui);
			color: var(--ink-quiet);
		}

		.picker :global(.periods) {
			display: flex;
			flex-wrap: wrap;
			gap: var(--space-sm);
		}

		/* At rest, settings' quiet button. Not a `.button`, so it is restated. */
		.picker :global(.period) {
			display: inline-flex;
			align-items: center;
			min-block-size: var(--tap-min);
			padding: var(--space-sm) var(--space-lg);
			font-family: var(--ff-ui);
			font-variant-numeric: tabular-nums;
			background: transparent;
			color: var(--ink-quiet);
			border: 1px solid var(--hue-z0-divider);
			border-radius: var(--radius-md);
			cursor: pointer;
		}

		.picker :global(.period:hover:not([data-disabled])) {
			color: var(--ink);
		}

		/* Shown by weight, fill, and the outline going, so not by colour alone. */
		.picker :global(.period[data-state='checked']) {
			background-color: var(--chip-bg);
			color: var(--ink);
			font-weight: 600;
			border-color: transparent;
		}

		/* `Button`'s own disabled rule, so a disabled control looks the same everywhere. */
		.picker :global(.period[data-disabled]) {
			opacity: 0.5;
			cursor: not-allowed;
		}

		/* A word in the sentence, not a control. */
		.lede :global(.button[data-variant='link']),
		.caption :global(.button[data-variant='link']) {
			min-block-size: 0;
			padding: 0;
			background: transparent;
			color: inherit;
			font: inherit;
			font-weight: normal;
			text-decoration: underline;
		}

		.compare {
			display: flex;
			flex-direction: column;
			gap: var(--space-lg);
		}

		/* Figure over label, as in the activity summary. */
		.figures {
			display: flex;
			flex-wrap: wrap;
			gap: var(--space-lg) var(--space-xl);
			margin: 0;
		}

		.figures > div {
			display: flex;
			flex-direction: column;
		}

		dd {
			margin: 0;
			font-size: var(--fs-3);
			line-height: 1.2;
		}

		dt {
			font-family: var(--ff-ui);
			font-size: var(--fs-0);
			color: var(--ink-quiet);
		}

		/*
		 * The series. Each bucket is the timeline strip's, so "nothing here"
		 * looks the same on the account card and on this screen; the fill is
		 * the one addition. Both halves share one scale, or the comparison
		 * would lie.
		 */
		.series {
			display: grid;
			grid-template-columns: 1fr 1fr;
			column-gap: var(--space-lg);
			container-type: inline-size;
		}

		.half {
			display: flex;
			flex-direction: column;
			gap: var(--space-2xs);
		}

		/* Taller than the strip's: this shows how much, not just whether. */
		.track {
			display: grid;
			grid-template-columns: repeat(var(--bucket-count), 1fr);
			gap: 2px;
			block-size: 4.5rem;
		}

		.bucket {
			position: relative;
			background-color: var(--strip-empty);
			border-radius: var(--radius-sm);
		}

		/* The 2px floor keeps one post visibly different from none. */
		.fill {
			position: absolute;
			inset-inline: 0;
			inset-block-end: 0;
			box-sizing: border-box;
			block-size: max(2px, calc(var(--fill) * 100%));
			border-radius: var(--radius-sm);
			background-color: var(--strip-active);
		}

		/* Hollow against solid: a difference of form, so it holds without colour. */
		.half[data-period='prior'] .fill {
			background-color: transparent;
			border: 2px solid var(--strip-active);
		}

		.label {
			font-family: var(--ff-ui);
			color: var(--ink-quiet);
		}

		.half[data-period='current'] .label {
			color: var(--ink);
		}

		@container (max-width: 30rem) {
			.track {
				gap: 1px;
				block-size: 3.5rem;
			}
		}

		.captions {
			display: flex;
			flex-direction: column;
			gap: var(--space-2xs);
		}

		.quiet {
			display: flex;
			flex-direction: column;
			gap: var(--space-sm);
		}

		h2 {
			margin: 0;
		}

		.empty {
			margin: 0;
			font-family: var(--ff-ui);
			color: var(--ink-quiet);
		}

		ul {
			list-style: none;
			margin: 0;
			padding: 0;
			display: flex;
			flex-direction: column;
		}

		/* A hairline per row, as on the kept list: this one can run to hundreds. */
		li {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: center;
			gap: var(--space-lg);
			padding-block: var(--space-sm);
			border-block-end: 1px solid var(--hue-z0-divider);
		}

		.who {
			display: flex;
			flex-direction: column;
			min-inline-size: 0;
		}

		.name {
			overflow-wrap: anywhere;
		}

		.handle,
		.when {
			font-family: var(--ff-ui);
			color: var(--ink-quiet);
			overflow-wrap: anywhere;
		}

		.handle {
			text-decoration: none;
		}

		.handle:hover {
			text-decoration: underline;
		}

		.handle[data-kind='did'] {
			font-family: var(--ff-mono);
		}

		.when {
			margin: 0;
			text-align: end;
		}

		/* So the line breaks at the dot and nowhere else. */
		.when span {
			white-space: nowrap;
		}

		.notes {
			display: flex;
			flex-direction: column;
			gap: var(--space-sm);
			font-family: var(--ff-ui);
			max-inline-size: 70ch;
		}

		.notes p {
			margin: 0;
			color: var(--ink-quiet);
		}

		/* phone — see the breakpoint note in src/lib/styles/tokens.css */
		@media (max-width: 40rem) {
			/* Equal columns keep the change beside the figures, not orphaned below. */
			.figures {
				display: grid;
				grid-auto-flow: column;
				grid-auto-columns: minmax(0, 1fr);
				gap: var(--space-lg);
			}

			.series {
				column-gap: var(--space-sm);
			}

			li {
				grid-template-columns: minmax(0, 1fr);
				gap: var(--space-2xs);
				padding-block: var(--space-lg);
			}

			.when {
				text-align: start;
			}
		}
	}
</style>
