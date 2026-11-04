import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { flushSync } from 'svelte';
import NetworkScreen from './NetworkScreen.svelte';
import { TriageSession } from '$lib/triage/session.svelte';
import type { ActivityEvent } from '$lib/atproto/activity';
import type { FollowSnapshot } from '$lib/storage/db';
import type { ActivityState } from '$lib/triage/scanner.svelte';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-14T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString();

function follow(did: string): FollowSnapshot {
	return {
		ownerDid: 'did:plc:owner',
		subjectDid: did,
		rkeys: ['aaa'],
		followedAt: '2021-06-04T00:00:00Z',
		followsOwner: null,
		loadedAt: '2026-09-14T00:00:00Z',
		profileMissingSince: null,
		profile: { did, handle: `${did.split(':').pop()}.test` }
	};
}

function ready(did: string, ...postedDaysAgo: number[]): ActivityState {
	const events: ActivityEvent[] = postedDaysAgo.map((d) => ({ kind: 'post', at: daysAgo(d) }));
	return {
		status: 'ready',
		error: null,
		lastActive: null,
		activity: {
			subjectDid: did,
			events,
			recent: [],
			window: { start: daysAgo(365), end: daysAgo(0), reason: 'lookback', truncated: false },
			lookbackDays: 365,
			fetchedAt: daysAgo(0),
			likesError: null
		}
	};
}

/** A session on the network screen, with storage and the network left out. */
function onNetwork(states: Record<string, ActivityState | null>) {
	const session = new TriageSession();
	session.session = {
		did: 'did:plc:owner',
		handle: 'owner.test',
		pds: 'https://pds.test',
		fetch: async () => new Response(null, { status: 200 })
	};
	session.subjects = Object.keys(states).map(follow);
	for (const [did, state] of Object.entries(states)) {
		if (state) session.scanner.states.set(did, state);
	}
	session.phase = 'network';
	return session;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('the network screen', () => {
	it('says how many accounts the figures are based on while activity loads', async () => {
		const session = onNetwork({
			'did:plc:a': ready('did:plc:a', 1),
			'did:plc:b': ready('did:plc:b', 40),
			'did:plc:c': null
		});

		const screen = render(NetworkScreen, { props: { session } });

		await expect
			.element(screen.getByRole('status'))
			.toHaveTextContent(
				'Still loading activity for 1 account. These figures are based on 2 of 3.'
			);
	});

	it('includes kept and marked accounts, but not ones a run has unfollowed', async () => {
		const session = onNetwork({
			'did:plc:kept': ready('did:plc:kept', 1),
			'did:plc:marked': ready('did:plc:marked', 1),
			'did:plc:gone': ready('did:plc:gone', 1)
		});
		for (const [did, decision] of [
			['did:plc:kept', 'keep'],
			['did:plc:marked', 'unfollow'],
			['did:plc:gone', 'unfollowed']
		] as const) {
			session.decisions.set(did, {
				ownerDid: 'did:plc:owner',
				subjectDid: did,
				decision,
				decidedAt: daysAgo(0)
			});
		}

		const screen = render(NetworkScreen, { props: { session } });

		await expect
			.element(screen.getByRole('heading', { level: 1 }))
			.toHaveTextContent('2 of 2 accounts posted in the last 30 days');
	});

	it('disables the periods the lookback is too short to compare, and says why', async () => {
		const session = onNetwork({ 'did:plc:a': ready('did:plc:a', 1) });
		session.settings = { ...session.settings, lookbackDays: 59 };

		const screen = render(NetworkScreen, { props: { session } });

		const radio = (name: string) => screen.getByRole('radio', { name });
		await expect.element(radio('7 days')).toBeChecked();
		await expect.element(radio('30 days')).toBeDisabled();
		await expect.element(radio('90 days')).toBeDisabled();
		await expect
			.element(screen.getByText(/To compare 30 days, load at least 60 days of history/))
			.toBeVisible();
	});

	it('offers no action on the list, only a link to each account', async () => {
		const session = onNetwork({
			'did:plc:a': ready('did:plc:a', 40),
			'did:plc:b': ready('did:plc:b', 45)
		});

		const screen = render(NetworkScreen, { props: { session } });
		await expect.element(screen.getByRole('link', { name: '@a.test' })).toBeVisible();

		const list = screen.container.querySelector('.quiet');
		expect({
			buttons: list?.querySelectorAll('button, input, [role="button"]').length,
			links: list?.querySelectorAll('a').length
		}).toEqual({ buttons: 0, links: 2 });
	});

	it('sends no request when it opens or when the period changes', async () => {
		const fetch = vi.spyOn(window, 'fetch');
		const session = onNetwork({ 'did:plc:a': ready('did:plc:a', 1, 10) });

		const screen = render(NetworkScreen, { props: { session } });
		await screen.getByRole('radio', { name: '7 days' }).click();
		await expect
			.element(screen.getByRole('heading', { level: 1 }))
			.toHaveTextContent('in the last 7 days');

		expect(fetch).not.toHaveBeenCalled();
	});

	it('catches up with the scan at most once a second', async () => {
		const session = onNetwork({ 'did:plc:a': ready('did:plc:a', 1), 'did:plc:b': null });
		session.scanner.running = true;

		const screen = render(NetworkScreen, { props: { session } });
		const heading = screen.getByRole('heading', { level: 1 });
		await expect.element(heading).toHaveTextContent('1 of 1 account posted');

		session.scanner.states.set('did:plc:b', ready('did:plc:b', 2));
		flushSync();
		const straightAway = heading.element().textContent?.replace(/\s+/g, ' ');

		await expect.element(heading, { timeout: 2000 }).toHaveTextContent('2 of 2 accounts posted');
		expect(straightAway).toContain('1 of 1 account posted');
	});
});
