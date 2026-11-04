import type { FollowSnapshot } from '$lib/storage/db';
import type { ActivityState } from '$lib/triage/scanner.svelte';

/**
 * The network metric definitions from PRD.md, "Network metrics".
 *
 * Pure, like `activity-stats`, and for the same reason: these figures describe
 * everyone the owner follows at once, and they have to be checkable against the
 * PRD without a screen in the way. They read only what the scan has already
 * loaded and never ask for more.
 */

const DAY_MS = 86_400_000;

export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];

/**
 * Bucket width per period. Each period is a whole number of buckets, so no
 * bucket straddles the line between the two.
 */
const BUCKET_DAYS: Record<Period, number> = { 7: 1, 30: 3, 90: 9 };

/** One row of the list: an account that posted in the prior period and not since. */
export interface QuietAccount {
	subject: FollowSnapshot;
	priorPosts: number;
	/** The latest post, reply, or repost, which is inside the prior period by definition. */
	lastPostAt: string;
}

export interface NetworkStats {
	period: Period;
	followed: number;
	counted: number;
	notCounted: { loading: number; failed: number; unavailable: number };
	/** Counted accounts with a post, reply, or repost in the current period. */
	posted: number;
	/** Counted accounts with a post, reply, or repost in the prior period. */
	postedBefore: number;
	compared: number;
	/** Counted accounts left out of the comparison because a page cap cut their window short. */
	fetchLimited: number;
	/** The compared accounts' posts, replies, and reposts in each period. */
	posts: { prior: number; current: number };
	perDay: { prior: number; current: number };
	/** Signed fraction from prior to current. Null when the prior period has no posts. */
	change: number | null;
	/** Oldest first. Each half is one period. */
	series: { bucketDays: number; prior: number[]; current: number[] };
	quiet: QuietAccount[];
}

/** Twice the period has to fit in the lookback, so the prior period is never cut off by it. */
export function isOffered(period: Period, lookbackDays: number): boolean {
	return 2 * period <= lookbackDays;
}

/**
 * The period asked for if it is offered, otherwise the longest one that is.
 * Null when the lookback is too short to offer any.
 */
export function offeredPeriod(wanted: Period, lookbackDays: number): Period | null {
	if (isOffered(wanted, lookbackDays)) return wanted;
	return PERIODS.findLast((period) => isOffered(period, lookbackDays)) ?? null;
}

export function computeNetworkStats(
	follows: readonly FollowSnapshot[],
	states: ReadonlyMap<string, ActivityState>,
	period: Period
): NetworkStats {
	const periodMs = period * DAY_MS;
	const bucketDays = BUCKET_DAYS[period];
	const bucketMs = bucketDays * DAY_MS;
	const series = new Array<number>((2 * period) / bucketDays).fill(0);

	const notCounted = { loading: 0, failed: 0, unavailable: 0 };
	const posts = { prior: 0, current: 0 };
	const quiet: QuietAccount[] = [];
	let counted = 0;
	let posted = 0;
	let postedBefore = 0;
	let compared = 0;

	for (const subject of follows) {
		// The scan never loads an account with no profile, so it has no state.
		if (!subject.profile) {
			notCounted.unavailable++;
			continue;
		}
		const state = states.get(subject.subjectDid);
		if (state?.status === 'error') {
			notCounted.failed++;
			continue;
		}
		if (state?.status !== 'ready' || !state.activity) {
			notCounted.loading++;
			continue;
		}
		counted++;

		const { events, window } = state.activity;
		const end = Date.parse(window.end);
		const windowStart = Date.parse(window.start);
		const priorStart = end - 2 * periodMs;

		/*
		 * Events are compared as ISO strings rather than parsed. Every stored
		 * timestamp went through `toISOString`, so string order is time order,
		 * and parsing a few million of them was most of this function's time
		 * on a large follow list. Only events that land in a bucket are parsed.
		 */
		const iso = (ms: number) => new Date(ms).toISOString();
		const [endAt, windowStartAt, priorStartAt, currentStartAt] = [
			iso(end),
			iso(windowStart),
			iso(priorStart),
			iso(end - periodMs)
		];

		/*
		 * Given the period rule, the only accounts whose window starts after
		 * the prior period does are the ones a page cap stopped short. Their
		 * prior period is partly unloaded, and comparing it would read as a
		 * drop that never happened. An account created since has a short
		 * window too, but there is nothing before its start to miss.
		 */
		const isCompared = windowStart <= priorStart || window.reason === 'account-created';
		if (isCompared) compared++;

		let prior = 0;
		let current = 0;
		let lastPostAt = '';
		for (const { kind, at } of events) {
			if (kind === 'like') continue;
			// Half-open on the left, so an instant on a boundary is in exactly one period.
			if (at < windowStartAt || at > endAt || at <= priorStartAt) continue;
			if (at > currentStartAt) current++;
			else prior++;
			if (at > lastPostAt) lastPostAt = at;
			if (isCompared) series[Math.ceil((Date.parse(at) - priorStart) / bucketMs) - 1]++;
		}

		if (current > 0) posted++;
		if (prior > 0) postedBefore++;
		if (prior > 0 && current === 0) quiet.push({ subject, priorPosts: prior, lastPostAt });
		if (isCompared) {
			posts.prior += prior;
			posts.current += current;
		}
	}

	quiet.sort((a, b) => b.priorPosts - a.priorPosts || b.lastPostAt.localeCompare(a.lastPostAt));

	return {
		period,
		followed: follows.length,
		counted,
		notCounted,
		posted,
		postedBefore,
		compared,
		fetchLimited: counted - compared,
		posts,
		perDay: { prior: posts.prior / period, current: posts.current / period },
		change: posts.prior === 0 ? null : (posts.current - posts.prior) / posts.prior,
		series: {
			bucketDays,
			prior: series.slice(0, series.length / 2),
			current: series.slice(series.length / 2)
		},
		quiet
	};
}
