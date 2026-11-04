import { expect, it } from 'vitest';
import type { ActivityEvent } from '$lib/atproto/activity';
import type { FollowSnapshot } from '$lib/storage/db';
import type { ActivityState } from '$lib/triage/scanner.svelte';
import { computeNetworkStats } from './network-stats';

/**
 * The budget, measured where it is spent.
 *
 * Named `.svelte.test.ts` so it runs in the browser project: the figures are
 * recomputed in the page while the scan runs, so the browser's speed is the
 * one that matters, not node's.
 */

const DAY = 86_400_000;
const SUBJECTS = 5_000;
const EVENTS_PER_SUBJECT = 500;
const KINDS = ['post', 'reply', 'repost', 'like'] as const;

function largeNetwork() {
	const end = Date.parse('2026-09-14T12:00:00.000Z');
	const follows: FollowSnapshot[] = [];
	const states = new Map<string, ActivityState>();

	for (let i = 0; i < SUBJECTS; i++) {
		const did = `did:plc:subject${i}`;
		// Spread across the default year's lookback, so every period has work in it.
		const events: ActivityEvent[] = Array.from({ length: EVENTS_PER_SUBJECT }, (_, j) => ({
			kind: KINDS[j % KINDS.length],
			at: new Date(end - ((j * 365) / EVENTS_PER_SUBJECT) * DAY - i * 1000).toISOString()
		}));
		follows.push({
			ownerDid: 'did:plc:owner',
			subjectDid: did,
			rkeys: ['aaa'],
			followedAt: null,
			followsOwner: null,
			loadedAt: '2026-09-14T00:00:00Z',
			profileMissingSince: null,
			profile: { did, handle: `subject${i}.test` }
		});
		states.set(did, {
			status: 'ready',
			error: null,
			lastActive: null,
			activity: {
				subjectDid: did,
				events,
				recent: [],
				window: {
					start: new Date(end - 365 * DAY).toISOString(),
					end: new Date(end).toISOString(),
					reason: 'lookback',
					truncated: false
				},
				lookbackDays: 365,
				fetchedAt: new Date(end).toISOString(),
				likesError: null
			}
		});
	}

	return { follows, states };
}

it('computes the figures for 5,000 accounts of 500 events each within 250 ms', () => {
	const { follows, states } = largeNetwork();

	const started = performance.now();
	computeNetworkStats(follows, states, 90);
	const elapsed = performance.now() - started;

	expect(elapsed).toBeLessThanOrEqual(250);
});
