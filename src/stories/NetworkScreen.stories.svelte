<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import NetworkScreen from '$lib/components/NetworkScreen.svelte';
	import { TriageSession } from '$lib/triage/session.svelte';
	import type { ActivityEvent, CoveredWindow } from '$lib/atproto/activity';
	import type { FollowSnapshot } from '$lib/storage/db';

	const { Story } = defineMeta({
		title: 'Triage/NetworkScreen',
		component: NetworkScreen,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' }
	});

	/** A fixed load time, so the figures read the same on every run. */
	const NOW = Date.parse('2026-09-14T12:00:00Z');
	const DAY = 86_400_000;
	const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString();

	/** A post every `step` days between two points, newest first. */
	function posts(step: number, from: number, to: number): ActivityEvent[] {
		const events: ActivityEvent[] = [];
		for (let days = from; days <= to; days += step) {
			events.push({ kind: days % 3 === 0 ? 'reply' : 'post', at: daysAgo(days) });
		}
		return events;
	}

	interface Account {
		handle: string;
		displayName?: string;
		events: ActivityEvent[];
		window?: Partial<CoveredWindow>;
	}

	const steady: Account[] = [
		{ handle: 'alice.bsky.social', displayName: 'Alice Example', events: posts(1, 0, 120) },
		{ handle: 'bob.example.com', displayName: 'Bob', events: posts(2, 1, 200) },
		{ handle: 'carol.bsky.social', displayName: 'Carol Mapmaker', events: posts(4, 0, 300) },
		{ handle: 'dee.bsky.social', events: posts(6, 2, 365) },
		{ handle: 'erin.bsky.social', displayName: 'Erin', events: posts(9, 3, 365) },
		{
			handle: 'frank.bsky.social',
			displayName: 'Frank, who started posting this summer',
			events: posts(2, 1, 18),
			window: { start: daysAgo(20), reason: 'account-created' }
		},
		{
			handle: 'heavy.liker.example',
			displayName: 'Someone who likes a lot',
			events: [
				...posts(5, 1, 9),
				...Array.from({ length: 50 }, (_, i) => ({ kind: 'like' as const, at: daysAgo(i / 5) }))
			],
			window: { start: daysAgo(10), reason: 'fetch-limit', truncated: true }
		}
	];

	const stopped: Account[] = [
		{
			handle: 'gail.bsky.social',
			displayName: 'Gail With A Rather Long Display Name That Wraps',
			events: posts(1, 31, 90)
		},
		{ handle: 'hal.example.org', displayName: 'Hal', events: posts(3, 33, 200) },
		{ handle: 'ivy.bsky.social', events: posts(20, 40, 365) },
		{ handle: 'jo.bsky.social', displayName: 'Jo', events: posts(3, 52, 300) }
	];

	function snapshot(handle: string, displayName?: string): FollowSnapshot {
		const did = `did:plc:${handle.split('.')[0]}`;
		return {
			ownerDid: 'did:plc:owner',
			subjectDid: did,
			rkeys: ['aaa'],
			followedAt: '2021-06-04T00:00:00Z',
			followsOwner: null,
			loadedAt: daysAgo(0),
			profileMissingSince: null,
			profile: { did, handle, displayName }
		};
	}

	/** A session on the network screen, with storage and the network left out. */
	function parked(
		accounts: Account[],
		{ loaded = accounts.length, lookbackDays = 365, unavailable = 0, failed = 0 } = {}
	) {
		const session = new TriageSession();
		session.session = {
			did: 'did:plc:owner',
			handle: 'owner.test',
			pds: 'https://pds.test',
			fetch: async () => new Response(null, { status: 200 })
		};
		session.settings = { ...session.settings, lookbackDays };

		const follows = accounts.map((account) => snapshot(account.handle, account.displayName));
		accounts.slice(0, loaded).forEach((account, i) => {
			const did = follows[i].subjectDid;
			session.scanner.states.set(did, {
				status: 'ready',
				error: null,
				lastActive: null,
				activity: {
					subjectDid: did,
					events: account.events,
					recent: [],
					window: {
						start: daysAgo(lookbackDays),
						end: daysAgo(0),
						reason: 'lookback',
						truncated: false,
						...account.window
					},
					lookbackDays,
					fetchedAt: daysAgo(0),
					likesError: null
				}
			});
		});
		for (let i = 0; i < failed; i++) {
			const follow = snapshot(`failed${i}.example`);
			follows.push(follow);
			session.scanner.states.set(follow.subjectDid, {
				status: 'error',
				error: 'Failed to fetch',
				activity: null,
				lastActive: null
			});
		}
		for (let i = 0; i < unavailable; i++) {
			follows.push({ ...snapshot(`gone${i}.example`), profile: null });
		}

		session.subjects = follows;
		session.scanner.running = loaded < accounts.length;
		session.phase = 'network';
		return session;
	}
</script>

<!--
	A finished scan: figures over every account, one left out of the comparison
	by the fetch limit, and the accounts that posted only in the earlier period.
-->
<Story name="Full data" asChild>
	<NetworkScreen session={parked([...steady, ...stopped], { failed: 1, unavailable: 2 })} />
</Story>

<!--
	The scan is still running. The figures are over what has loaded so far, and
	the status line says how many that is.
-->
<Story name="Partial scan" asChild>
	<NetworkScreen session={parked([...steady, ...stopped], { loaded: 6 })} />
</Story>

<!-- Nothing has loaded yet. No figures, and no placeholders pretending to be some. -->
<Story name="Nothing counted yet" asChild>
	<NetworkScreen session={parked([...steady, ...stopped], { loaded: 0 })} />
</Story>

<!-- Every account failed to load or has no profile, as when the network is down. -->
<Story name="Nothing could be counted" asChild>
	<NetworkScreen session={parked([], { failed: 3, unavailable: 1 })} />
</Story>

<!-- Everyone who posted in the earlier period also posted in the later one. -->
<Story name="Nobody posted before only" asChild>
	<NetworkScreen session={parked(steady)} />
</Story>

<!--
	A 30-day lookback leaves room for only the 7-day comparison. The longer
	periods stay in place, disabled, with the way to make them available.
-->
<Story name="Lookback too short for 30 days" asChild>
	<NetworkScreen session={parked([...steady, ...stopped], { lookbackDays: 30 })} />
</Story>

<!-- Under 14 days of lookback, no period fits twice. No figures, only the way to fix it. -->
<Story name="Lookback too short for any period" asChild>
	<NetworkScreen session={parked([...steady, ...stopped], { lookbackDays: 10 })} />
</Story>
