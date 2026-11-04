<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import AppChrome from '$lib/components/AppChrome.svelte';
	import { TriageSession } from '$lib/triage/session.svelte';
	import type { FollowSnapshot } from '$lib/storage/db';

	const { Story } = defineMeta({
		title: 'Shell/AppChrome',
		component: AppChrome,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' }
	});

	const subject: FollowSnapshot = {
		ownerDid: 'did:plc:owner',
		subjectDid: 'did:plc:alice',
		rkeys: ['aaa'],
		followedAt: '2021-06-04T00:00:00Z',
		followsOwner: true,
		loadedAt: '2026-09-11T00:00:00Z',
		profileMissingSince: null,
		profile: { did: 'did:plc:alice', handle: 'alice.bsky.social', displayName: 'Alice Example' }
	};

	/** A session parked in one phase, with storage and the network left out. */
	function parked(phase: TriageSession['phase']) {
		const session = new TriageSession();
		session.session = {
			did: 'did:plc:owner',
			handle: 'owner.test',
			pds: 'https://pds.test',
			fetch: async () => new Response(null, { status: 200 })
		};
		session.subjects = [subject];
		session.current = subject;
		session.phase = phase;
		return session;
	}
</script>

<!--
	The ordinary case: the wordmark is a button back to the card, and all three
	utility controls are present.
-->
<Story name="Signed in" asChild>
	<AppChrome session={parked('triage')} />
</Story>

<!--
	Before sign-in the wordmark is a plain span and the utility bar is absent.
	There is nowhere to go back to and nothing to start over.
-->
<Story name="Signed out" asChild>
	<AppChrome session={parked('signed-out')} />
</Story>

<!--
	A run in flight: the wordmark goes inert and the utility bar disappears, so
	nothing offers to navigate away or change settings mid-delete.
-->
<Story name="Run in flight" asChild>
	<AppChrome session={parked('running')} />
</Story>

<!--
	Settings hides its own link but keeps the wordmark live, which is the way
	back out of it.
-->
<Story name="On settings" asChild>
	<AppChrome session={parked('settings')} />
</Story>

<!--
	On the network screen its own link becomes plain text marked as the current
	page, keeping its place so the links beside it do not move.
-->
<Story name="On follows" asChild>
	<AppChrome session={parked('network')} />
</Story>
