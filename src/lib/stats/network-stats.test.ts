import { describe, expect, it } from 'vitest';
import type { ActivityEvent, CoveredWindow, EventKind } from '$lib/atproto/activity';
import type { FollowSnapshot } from '$lib/storage/db';
import type { ActivityState } from '$lib/triage/scanner.svelte';
import { computeNetworkStats, offeredPeriod } from './network-stats';

/**
 * These cases are read from PRD.md, NET-1 and "Network metrics", not from the
 * implementation.
 */

const DAY = 86_400_000;

/** Each account's load time, which is where its periods are measured back from. */
const NOW = Date.parse('2026-09-14T12:00:00.000Z');

const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString();

function follow(did: string, { profile = true } = {}): FollowSnapshot {
	return {
		ownerDid: 'did:plc:owner',
		subjectDid: did,
		rkeys: ['aaa'],
		followedAt: '2021-06-04T00:00:00Z',
		followsOwner: null,
		loadedAt: '2026-09-14T00:00:00Z',
		profileMissingSince: null,
		profile: profile ? { did, handle: `${did.split(':').pop()}.test` } : null
	};
}

function events(kind: EventKind, ...days: number[]): ActivityEvent[] {
	return days.map((d) => ({ kind, at: daysAgo(d) }));
}

function ready(
	did: string,
	loaded: ActivityEvent[],
	window: Partial<CoveredWindow> = {},
	likesError: string | null = null
): ActivityState {
	return {
		status: 'ready',
		error: null,
		lastActive: null,
		activity: {
			subjectDid: did,
			events: loaded,
			recent: [],
			window: {
				start: daysAgo(365),
				end: daysAgo(0),
				reason: 'lookback',
				truncated: false,
				...window
			},
			lookbackDays: 365,
			fetchedAt: daysAgo(0),
			likesError
		}
	};
}

const pending: ActivityState = { status: 'pending', activity: null, error: null, lastActive: null };

/** A network where every account has loaded, keyed by DID. */
function network(entries: Record<string, ActivityState>, period: 7 | 30 | 90 = 30) {
	const follows = Object.keys(entries).map((did) => follow(did));
	return computeNetworkStats(follows, new Map(Object.entries(entries)), period);
}

describe('counted accounts', () => {
	it('adds up to the accounts followed, with each reason counted', () => {
		const follows = [
			follow('did:plc:ready'),
			follow('did:plc:waiting'),
			follow('did:plc:loading'),
			follow('did:plc:failed'),
			follow('did:plc:gone', { profile: false })
		];
		const states = new Map<string, ActivityState>([
			['did:plc:ready', ready('did:plc:ready', [])],
			['did:plc:loading', { ...pending, status: 'loading' }],
			['did:plc:failed', { ...pending, status: 'error', error: 'PDS unreachable' }]
		]);

		const stats = computeNetworkStats(follows, states, 30);

		expect({ followed: stats.followed, counted: stats.counted, ...stats.notCounted }).toEqual({
			followed: 5,
			counted: 1,
			loading: 2,
			failed: 1,
			unavailable: 1
		});
	});

	it('counts an account whose likes could not be loaded but whose posts did', () => {
		const stats = network({
			'did:plc:a': ready('did:plc:a', events('post', 3), {}, 'CORS blocked')
		});

		expect({ counted: stats.counted, posted: stats.posted }).toEqual({ counted: 1, posted: 1 });
	});
});

describe('posted in period', () => {
	it('counts accounts with a post, reply, or repost in the last P days', () => {
		const stats = network({
			'did:plc:poster': ready('did:plc:poster', events('post', 2)),
			'did:plc:replier': ready('did:plc:replier', events('reply', 29)),
			'did:plc:reposter': ready('did:plc:reposter', events('repost', 1)),
			'did:plc:earlier': ready('did:plc:earlier', events('post', 31)),
			'did:plc:silent': ready('did:plc:silent', [])
		});

		expect({ posted: stats.posted, counted: stats.counted }).toEqual({ posted: 3, counted: 5 });
	});

	it('ignores likes', () => {
		const stats = network({
			'did:plc:liker': ready('did:plc:liker', events('like', 1, 2, 40, 50))
		});

		expect({
			posted: stats.posted,
			postedBefore: stats.postedBefore,
			posts: stats.posts,
			quiet: stats.quiet.length
		}).toEqual({ posted: 0, postedBefore: 0, posts: { prior: 0, current: 0 }, quiet: 0 });
	});

	it('only counts events inside the covered window', () => {
		// The window was cut short by the page cap 10 days ago. A stray older
		// event is outside what the loaded data accounts for.
		const stats = network({
			'did:plc:a': ready('did:plc:a', events('post', 20), {
				start: daysAgo(10),
				reason: 'fetch-limit',
				truncated: true
			})
		});

		expect(stats.posted).toBe(0);
	});

	it('still counts an account whose window was truncated inside the current period', () => {
		const stats = network({
			'did:plc:heavy': ready('did:plc:heavy', events('post', 1, 2, 3), {
				start: daysAgo(5),
				reason: 'fetch-limit',
				truncated: true
			})
		});

		expect({ counted: stats.counted, posted: stats.posted, compared: stats.compared }).toEqual({
			counted: 1,
			posted: 1,
			compared: 0
		});
	});
});

describe('period boundaries', () => {
	// Current is (E−P, E] and prior is (E−2P, E−P], so every instant belongs
	// to at most one period and none is counted twice.
	it('puts an event exactly P days back in the prior period', () => {
		const stats = network({ 'did:plc:a': ready('did:plc:a', events('post', 30)) });

		expect(stats.posts).toEqual({ prior: 1, current: 0 });
	});

	it('puts an event at load time in the current period', () => {
		const stats = network({ 'did:plc:a': ready('did:plc:a', events('post', 0)) });

		expect(stats.posts).toEqual({ prior: 0, current: 1 });
	});

	it('leaves an event exactly 2P days back out of both periods', () => {
		const stats = network({ 'did:plc:a': ready('did:plc:a', events('post', 60)) });

		expect(stats.posts).toEqual({ prior: 0, current: 0 });
	});

	it("measures each account's periods back from its own load time", () => {
		// Loaded a day apart, as the 24-hour cache allows. The same instant is
		// inside one account's current period and outside the other's.
		const lateLoad = ready('did:plc:late', events('post', 30.5));
		const earlyLoad = ready('did:plc:early', events('post', 30.5), { end: daysAgo(1) });

		const stats = network({ 'did:plc:late': lateLoad, 'did:plc:early': earlyLoad });

		expect(stats.posts).toEqual({ prior: 1, current: 1 });
	});
});

describe('compared accounts', () => {
	it('leaves out an account truncated inside the prior period, and counts it', () => {
		const stats = network({
			'did:plc:whole': ready('did:plc:whole', events('post', 5, 45)),
			'did:plc:cut': ready('did:plc:cut', events('post', 5, 45), {
				start: daysAgo(50),
				reason: 'fetch-limit',
				truncated: true
			})
		});

		expect({
			counted: stats.counted,
			compared: stats.compared,
			fetchLimited: stats.fetchLimited,
			posts: stats.posts
		}).toEqual({ counted: 2, compared: 1, fetchLimited: 1, posts: { prior: 1, current: 1 } });
	});

	it('includes an account created inside the prior period', () => {
		const stats = network({
			'did:plc:new': ready('did:plc:new', events('post', 5, 45), {
				start: daysAgo(50),
				reason: 'account-created'
			})
		});

		expect({ compared: stats.compared, fetchLimited: stats.fetchLimited }).toEqual({
			compared: 1,
			fetchLimited: 0
		});
	});

	it('includes an account truncated exactly at the start of the prior period', () => {
		const stats = network({
			'did:plc:a': ready('did:plc:a', events('post', 59), {
				start: daysAgo(60),
				reason: 'fetch-limit',
				truncated: true
			})
		});

		expect(stats.compared).toBe(1);
	});
});

describe('posts per day', () => {
	it('divides each period’s posts by P, with the change from prior to current', () => {
		const stats = network({
			'did:plc:a': ready('did:plc:a', [
				...events('post', 1, 2, 3),
				...events('reply', 4, 5, 6),
				...events('post', 31, 32, 33, 34)
			])
		});

		expect({ perDay: stats.perDay, change: stats.change }).toEqual({
			perDay: { current: 6 / 30, prior: 4 / 30 },
			change: 0.5
		});
	});

	it('has no change when the prior period has no posts', () => {
		const stats = network({ 'did:plc:a': ready('did:plc:a', events('post', 1, 2)) });

		expect(stats.change).toBeNull();
	});
});

describe('series', () => {
	it.each([
		[7, 14, 1],
		[30, 20, 3],
		[90, 20, 9]
	] as const)('splits P = %i into %i buckets of %i days', (period, buckets, days) => {
		const stats = network({ 'did:plc:a': ready('did:plc:a', []) }, period);

		expect({
			buckets: stats.series.prior.length + stats.series.current.length,
			halves: stats.series.prior.length === stats.series.current.length,
			days: stats.series.bucketDays
		}).toEqual({ buckets, halves: true, days });
	});

	it('sums to the period totals', () => {
		const stats = network({
			'did:plc:a': ready('did:plc:a', events('post', 0, 1, 3, 3.5, 29.9, 30, 30.1, 59.99)),
			'did:plc:b': ready('did:plc:b', events('repost', 2, 12, 44, 60, 61))
		});

		const sum = (counts: number[]) => counts.reduce((total, count) => total + count, 0);
		expect({ prior: sum(stats.series.prior), current: sum(stats.series.current) }).toEqual(
			stats.posts
		);
	});

	it('places buckets oldest first, with half-open edges like the periods', () => {
		// P = 30 is ten buckets of 3 days per half. 3 days back is the end of
		// the second-to-last bucket; 0 is the end of the last.
		const stats = network({ 'did:plc:a': ready('did:plc:a', events('post', 0, 3, 59)) });

		expect(stats.series).toEqual({
			bucketDays: 3,
			prior: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
			current: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1]
		});
	});

	it('counts only compared accounts', () => {
		const stats = network({
			'did:plc:cut': ready('did:plc:cut', events('post', 1), {
				start: daysAgo(5),
				reason: 'fetch-limit',
				truncated: true
			})
		});

		expect(stats.series.current.every((count) => count === 0)).toBe(true);
	});
});

describe('posted before only', () => {
	it('lists accounts that posted in the prior period and not the current one', () => {
		const stats = network({
			'did:plc:stopped': ready('did:plc:stopped', events('post', 40)),
			'did:plc:carried-on': ready('did:plc:carried-on', events('post', 1, 40)),
			'did:plc:started': ready('did:plc:started', events('post', 1)),
			'did:plc:never': ready('did:plc:never', events('post', 200))
		});

		expect(stats.quiet.map((row) => row.subject.subjectDid)).toEqual(['did:plc:stopped']);
	});

	it('orders by prior-period posts, most first, then by last post, most recent first', () => {
		const stats = network({
			'did:plc:one-old': ready('did:plc:one-old', events('post', 55)),
			'did:plc:three': ready('did:plc:three', events('post', 40, 41, 42)),
			'did:plc:one-recent': ready('did:plc:one-recent', events('reply', 31))
		});

		expect(
			stats.quiet.map((row) => [row.subject.subjectDid, row.priorPosts, row.lastPostAt])
		).toEqual([
			['did:plc:three', 3, daysAgo(40)],
			['did:plc:one-recent', 1, daysAgo(31)],
			['did:plc:one-old', 1, daysAgo(55)]
		]);
	});

	it('includes a counted account left out of the comparison', () => {
		// Its prior period is only partly loaded, but a post seen there is
		// still a post.
		const stats = network({
			'did:plc:cut': ready('did:plc:cut', events('post', 45), {
				start: daysAgo(50),
				reason: 'fetch-limit',
				truncated: true
			})
		});

		expect(stats.quiet).toHaveLength(1);
	});

	it('counts how many counted accounts posted in the prior period at all', () => {
		const stats = network({
			'did:plc:a': ready('did:plc:a', events('post', 1, 40)),
			'did:plc:b': ready('did:plc:b', events('post', 40)),
			'did:plc:c': ready('did:plc:c', events('post', 1))
		});

		expect(stats.postedBefore).toBe(2);
	});
});

describe('offered periods', () => {
	it('keeps the period asked for when twice it fits in the lookback', () => {
		expect([offeredPeriod(30, 60), offeredPeriod(7, 365)]).toEqual([30, 7]);
	});

	it('falls back to the longest period offered when it does not', () => {
		expect([offeredPeriod(90, 179), offeredPeriod(30, 59)]).toEqual([30, 7]);
	});

	it('offers no period when the lookback is too short to compare even 7 days', () => {
		expect([offeredPeriod(30, 13), offeredPeriod(7, 14)]).toEqual([null, 7]);
	});
});
