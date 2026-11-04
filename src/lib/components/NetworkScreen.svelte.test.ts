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

/** Loaded, but stopped by the page cap `startDaysAgo` days back. */
function capped(did: string, startDaysAgo: number, ...postedDaysAgo: number[]): ActivityState {
	const state = ready(did, ...postedDaysAgo);
	state.activity!.window = {
		start: daysAgo(startDaysAgo),
		end: daysAgo(0),
		reason: 'fetch-limit',
		truncated: true
	};
	return state;
}

const FAILED: ActivityState = {
	status: 'error',
	error: 'HTTP 502',
	activity: null,
	lastActive: null
};

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

	it('says how much lookback it needs when it can compare no period, and links to settings', async () => {
		const session = onNetwork({ 'did:plc:a': ready('did:plc:a', 1) });
		session.settings = { ...session.settings, lookbackDays: 13 };

		const screen = render(NetworkScreen, { props: { session } });
		await expect
			.element(screen.getByText(/^To compare 7 days/))
			.toHaveTextContent('To compare 7 days, load at least 14 days of history in Settings.');
		await screen.getByRole('button', { name: 'Settings' }).click();

		expect(session.phase).toBe('settings');
	});

	it('links the lookback line to settings', async () => {
		const session = onNetwork({ 'did:plc:a': ready('did:plc:a', 1) });
		session.settings = { ...session.settings, lookbackDays: 59 };

		const screen = render(NetworkScreen, { props: { session } });
		await screen.getByRole('button', { name: 'Settings' }).click();

		expect(session.phase).toBe('settings');
	});

	it('gives the share of counted accounts that posted', async () => {
		const session = onNetwork({
			'did:plc:a': ready('did:plc:a', 1),
			'did:plc:b': ready('did:plc:b', 40),
			'did:plc:c': ready('did:plc:c', 40),
			'did:plc:d': ready('did:plc:d')
		});

		const screen = render(NetworkScreen, { props: { session } });

		await expect
			.element(screen.getByText(/^That is/))
			.toHaveTextContent('That is 25% of the accounts you follow.');
	});

	it('says likes are not counted, and counts none', async () => {
		const state = ready('did:plc:a', 40);
		state.activity!.events.push({ kind: 'like', at: daysAgo(1) });
		const session = onNetwork({ 'did:plc:a': state });

		const screen = render(NetworkScreen, { props: { session } });

		await expect
			.element(screen.getByRole('heading', { level: 1 }))
			.toHaveTextContent('0 of 1 account posted');
		await expect.element(screen.getByText(/Likes are not counted/)).toBeVisible();
	});

	it('shows a fall in posts a day with a true minus sign', async () => {
		const session = onNetwork({ 'did:plc:a': ready('did:plc:a', 1, 40, 45) });

		const screen = render(NetworkScreen, { props: { session } });

		await expect.element(screen.getByText('\u221250%')).toBeVisible();
	});

	it('shows no change, and says why, when the period before has no posts', async () => {
		const session = onNetwork({ 'did:plc:a': ready('did:plc:a', 1) });

		const screen = render(NetworkScreen, { props: { session } });

		await expect
			.element(screen.getByText('No posts in the 30 days before, so there is no change to show.'))
			.toBeVisible();
		expect(screen.getByText('Change', { exact: true }).elements()).toHaveLength(0);
	});

	it('says how many accounts the fetch limit leaves out of the comparison', async () => {
		const session = onNetwork({
			'did:plc:a': ready('did:plc:a', 1, 40),
			'did:plc:b': capped('did:plc:b', 20, 1),
			'did:plc:c': capped('did:plc:c', 5, 1)
		});

		const screen = render(NetworkScreen, { props: { session } });

		await expect
			.element(screen.getByText(/more than the app loads/))
			.toHaveTextContent(
				'2 accounts post or like more than the app loads, so not all of their posts and likes from the last 60 days are loaded.'
			);
	});

	it('says how many accounts failed to load and how many have no profile', async () => {
		const session = onNetwork({
			'did:plc:a': ready('did:plc:a', 1),
			'did:plc:b': FAILED,
			'did:plc:c': FAILED,
			'did:plc:d': null
		});
		session.subjects[3] = { ...session.subjects[3], profile: null };

		const screen = render(NetworkScreen, { props: { session } });

		await expect
			.element(screen.getByText(/could not be loaded/))
			.toHaveTextContent('Activity could not be loaded for 2 accounts');
		await expect
			.element(screen.getByText(/no profile/))
			.toHaveTextContent('1 account has no profile, so it is not counted.');
	});

	it('points to the lines that say why, when no account could be counted', async () => {
		const session = onNetwork({ 'did:plc:a': FAILED, 'did:plc:b': null });
		session.subjects[1] = { ...session.subjects[1], profile: null };

		const screen = render(NetworkScreen, { props: { session } });

		const lede = screen.getByText(/could be counted/).element();
		const reasons = screen.getByText(/could not be loaded/).element();
		expect({
			lede: lede.textContent?.replace(/\s+/g, ' ').trim(),
			reasonsFollow: Boolean(
				lede.compareDocumentPosition(reasons) & Node.DOCUMENT_POSITION_FOLLOWING
			)
		}).toEqual({
			lede: 'No account you follow could be counted. The lines below say why.',
			reasonsFollow: true
		});
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
