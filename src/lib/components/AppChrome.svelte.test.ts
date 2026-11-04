import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AppChrome from './AppChrome.svelte';
import { TriageSession } from '$lib/triage/session.svelte';
import type { FollowSnapshot } from '$lib/storage/db';

const subject: FollowSnapshot = {
	ownerDid: 'did:plc:owner',
	subjectDid: 'did:plc:alice',
	rkeys: ['aaa'],
	followedAt: '2021-06-04T00:00:00Z',
	followsOwner: null,
	loadedAt: '2026-09-11T00:00:00Z',
	profileMissingSince: null,
	profile: { did: 'did:plc:alice', handle: 'alice.test', displayName: 'Alice' }
};

/** A signed-in session parked on one subject, with storage and network left out. */
function signedIn(phase: TriageSession['phase'] = 'triage') {
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

describe('the wordmark', () => {
	it('is inert before sign-in, when there is no card to go back to', async () => {
		const session = new TriageSession();
		session.phase = 'signed-out';

		const screen = render(AppChrome, { props: { session } });

		await expect.element(screen.getByText('unfollow.garden')).toBeInTheDocument();
		expect(screen.container.querySelector('button.wordmark')).toBeNull();
	});

	it('is inert during a run, which is not somewhere to navigate away from', async () => {
		const screen = render(AppChrome, { props: { session: signedIn('running') } });

		await expect.element(screen.getByText('unfollow.garden')).toBeInTheDocument();
		expect(screen.container.querySelector('button.wordmark')).toBeNull();
	});

	it('goes back to the card from settings', async () => {
		const session = signedIn('settings');

		const screen = render(AppChrome, { props: { session } });
		await screen.getByRole('button', { name: 'unfollow.garden' }).click();

		expect(session.phase).toBe('triage');
	});

	it('keeps the subject already on screen rather than re-sorting the queue', async () => {
		// Background loading moves the queue while the user is away. Coming
		// back from settings must not swap the card for someone else.
		const session = signedIn('settings');
		const advance = vi.spyOn(session, 'advance');

		const screen = render(AppChrome, { props: { session } });
		await screen.getByRole('button', { name: 'unfollow.garden' }).click();

		expect({ current: session.current?.subjectDid, advanced: advance.mock.calls.length }).toEqual({
			current: 'did:plc:alice',
			advanced: 0
		});
	});

	it('picks a new subject when the one on screen has been decided', async () => {
		const session = signedIn('review');
		session.decisions.set('did:plc:alice', {
			ownerDid: 'did:plc:owner',
			subjectDid: 'did:plc:alice',
			decision: 'keep',
			decidedAt: '2026-09-11T00:00:00Z'
		});
		const advance = vi.spyOn(session, 'advance');

		const screen = render(AppChrome, { props: { session } });
		// On the word itself. On a phone the band spans the page and the
		// utility links sit over its far half, so its middle is a link.
		await screen
			.getByRole('button', { name: 'unfollow.garden' })
			.click({ position: { x: 8, y: 8 } });

		expect(advance).toHaveBeenCalled();
	});
});

describe('start over', () => {
	it('asks before clearing, rather than clearing on the first click', async () => {
		const session = signedIn();
		const reset = vi.spyOn(session, 'resetDecisions').mockResolvedValue();

		const screen = render(AppChrome, { props: { session } });
		await screen.getByRole('button', { name: 'Start over' }).click();

		await expect
			.element(screen.getByRole('button', { name: 'Clear every decision' }))
			.toBeVisible();
		expect(reset).not.toHaveBeenCalled();
	});

	it('clears only once the consequence has been confirmed', async () => {
		const session = signedIn();
		const reset = vi.spyOn(session, 'resetDecisions').mockResolvedValue();

		const screen = render(AppChrome, { props: { session } });
		await screen.getByRole('button', { name: 'Start over' }).click();
		await screen.getByRole('button', { name: 'Clear every decision' }).click();

		expect(reset).toHaveBeenCalledTimes(1);
	});

	it('goes back to resting on cancel, with nothing cleared', async () => {
		const session = signedIn();
		const reset = vi.spyOn(session, 'resetDecisions').mockResolvedValue();

		const screen = render(AppChrome, { props: { session } });
		await screen.getByRole('button', { name: 'Start over' }).click();
		await screen.getByRole('button', { name: 'Cancel' }).click();

		await expect.element(screen.getByRole('button', { name: 'Start over' })).toBeVisible();
		expect(reset).not.toHaveBeenCalled();
	});

	it('is not offered during a run, where the utility bar is gone entirely', async () => {
		const screen = render(AppChrome, { props: { session: signedIn('running') } });

		expect(screen.container.querySelector('.utility')).toBeNull();
	});

	it('is not offered before sign-in, when there is nothing to start over', async () => {
		const session = new TriageSession();
		session.phase = 'signed-out';

		const screen = render(AppChrome, { props: { session } });

		expect(screen.container.querySelector('.utility')).toBeNull();
	});
});

describe('the follows link', () => {
	it('opens the network screen', async () => {
		const session = signedIn();

		const screen = render(AppChrome, { props: { session } });
		await screen.getByRole('button', { name: 'Follows' }).click();

		expect(session.phase).toBe('network');
	});

	it('is plain text marked as the current page once there', async () => {
		const screen = render(AppChrome, { props: { session: signedIn('network') } });

		await expect.element(screen.getByText('Follows')).toHaveAttribute('aria-current', 'page');
		expect(screen.getByRole('button', { name: 'Follows' }).query()).toBeNull();
	});

	it('is not offered while the follow list loads, when there is nothing to count', async () => {
		const screen = render(AppChrome, { props: { session: signedIn('loading') } });

		await expect.element(screen.getByRole('button', { name: 'Settings' })).toBeVisible();
		expect(screen.container.textContent).not.toContain('Follows');
	});
});
