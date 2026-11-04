import { untrack } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import type { BrowserOAuthClient } from '@atproto/oauth-client-browser';
import {
	createOAuthClient,
	restoreOwner,
	signOutOwner,
	startSignIn,
	type OwnerSession
} from '$lib/atproto/oauth';
import { getFollowsOwner, getProfiles, listFollows } from '$lib/atproto/graph';
import {
	exportOwner,
	importOwner,
	requestPersistence,
	type ImportReport
} from '$lib/storage/backup';
import {
	DEFAULT_SETTINGS,
	deleteDecisions,
	deleteOwnerData,
	loadRuns,
	type RunRecord,
	loadDecisions,
	loadFollows,
	loadSettings,
	saveDecision,
	saveFollows,
	saveSettings,
	undoLast,
	type Decision,
	type DecisionRecord,
	type FollowSnapshot,
	type Settings
} from '$lib/storage/db';
import { ActivityScanner } from './scanner.svelte';
import { IdentityProbe } from './identity.svelte';
import { HandleResolver } from './handles.svelte';
import { CostMeter } from '$lib/cost/meter.svelte';
import { RunController } from './runs.svelte';
import { computeNetworkStats, offeredPeriod, type Period } from '$lib/stats/network-stats';

export type Phase =
	| 'signed-out'
	| 'signing-in'
	| 'loading'
	| 'triage'
	| 'done'
	/** Reviewing the marked list before anything is deleted (PRD, RUN-1). */
	| 'review'
	/** Browsing what has already been kept, so a later pass can be audited. */
	| 'kept'
	/** The cost comparison, broken down so it can be checked. */
	| 'cost'
	/** How the accounts followed now posted over two recent periods. */
	| 'network'
	/** A run is in flight, or has just finished. */
	| 'running'
	/** Settings, past runs, backup, and delete-all. */
	| 'settings';

/**
 * The most recent thing the user did to a subject, so it can be named and taken
 * back.
 *
 * Held as one field rather than derived from the decision stack because a skip
 * is not on that stack — it is session-only by design — and "undo the last
 * thing I did" has to mean the same thing whichever of the two it was.
 */
export interface LastAction {
	kind: 'keep' | 'unfollow' | 'skip';
	subjectDid: string;
	/** How to name the account in the notice: display name, else handle. */
	label: string;
	/**
	 * Distinguishes one action from the next.
	 *
	 * Two identical decisions in a row produce identical records, and the
	 * notice has to restart its timer for the second one rather than quietly
	 * carrying on counting down from the first.
	 */
	seq: number;
}

/**
 * Tokens are the library's problem, not this file's.
 *
 * v0 kept app-password tokens in `sessionStorage` so a full-access credential
 * would die with the tab. OAuth removes the need: tokens are DPoP-bound, held
 * by `@atproto/oauth-client-browser` in IndexedDB, and refreshed on their own.
 * Application code never touches a credential, so there is nothing here to
 * store or clear.
 */

/** What the loading screen is currently doing. */
export interface Progress {
	step: string;
	loaded: number;
	total: number | null;
}

export class TriageSession {
	phase = $state<Phase>('signed-out');
	session = $state<OwnerSession | null>(null);

	/**
	 * The OAuth client, built once on mount.
	 *
	 * Held rather than rebuilt per call because `revoke` and `init` have to run
	 * against the same IndexedDB-backed store that issued the session.
	 */
	private client: BrowserOAuthClient | null = null;
	error = $state<string | null>(null);
	progress = $state<Progress>({ step: '', loaded: 0, total: null });

	subjects = $state<FollowSnapshot[]>([]);

	/** Lookback and gap threshold, stored per owner. */
	settings = $state<Settings>({ ownerDid: '', ...DEFAULT_SETTINGS });

	/**
	 * Activity loading, which runs behind the triage loop.
	 *
	 * Owned by the session rather than the screen so a subject's activity
	 * survives the screen being swapped out from under it, and so the queue can
	 * read what has loaded when it decides who is next.
	 */
	scanner = new ActivityScanner();

	/**
	 * Who an account used to be, for the ones with no profile to show.
	 *
	 * Lazy and per-subject, unlike the scanner: it answers a question only the
	 * card currently on screen is asking (PRD, VIEW-2).
	 */
	identities = new IdentityProbe();

	/**
	 * Handles mentioned in bios, resolved to DIDs.
	 *
	 * Only consulted when the chosen web client addresses accounts by DID, and
	 * cached for the sitting — the answer does not change.
	 */
	handles = new HandleResolver();

	/**
	 * True while a decision or an undo is being written.
	 *
	 * Every one of these reads the subject on screen, writes, and only then
	 * moves on — so a second press arriving inside that window acts on a
	 * subject the screen has not left yet. Two keeps on one account wrote it to
	 * the undo stack twice, and the second undo popped an entry whose decision
	 * was already gone, which looked like undo silently breaking after one use.
	 *
	 * A dropped keystroke inside a few milliseconds is a far smaller cost than
	 * a stack that no longer describes what the user did.
	 */
	#acting = false;

	/**
	 * What this review has fetched, for the cost comparison.
	 *
	 * Counts only, and only resources that crossed the network — the rate card
	 * that turns them into money lives in `$lib/cost/x-rates` and can change
	 * without rewriting anyone's history.
	 */
	meter = new CostMeter();

	/** Unfollow runs. Separate from triage because a run outlives the queue. */
	runs = new RunController();

	/** Past runs, loaded when the settings screen opens. */
	pastRuns = $state<RunRecord[]>([]);

	/**
	 * Whether the browser has promised not to evict this origin's storage.
	 *
	 * Null means the browser does not offer the guarantee at all, which is a
	 * different answer from "no" and is the case export exists for (STORE-2).
	 */
	persisted = $state<boolean | null>(null);

	/** What the last import did, so the user is told rather than left guessing. */
	importReport = $state<ImportReport | null>(null);

	/**
	 * Why follow-back status is missing, when it is.
	 *
	 * Separate from `error` because it does not stop anything: the review still
	 * works, it is just missing one signal. Held so the screen can say "unknown"
	 * instead of letting a blank read as "no".
	 */
	followBackError = $state<string | null>(null);

	/** The phase to return to when settings closes. */
	private phaseBeforeSettings: Phase = 'triage';

	/**
	 * Reactive collections rather than reassigned plain ones.
	 *
	 * A plain Map in `$state` only notifies when the whole Map is replaced, so
	 * every write means copying the collection. At a few thousand subjects that
	 * is a copy per keystroke. `SvelteMap` tracks per-entry (PRD, "Architecture
	 * on suede").
	 */
	decisions = new SvelteMap<string, DecisionRecord>();

	/**
	 * Subjects deferred rather than decided.
	 *
	 * Session-only by design (PRD, "Terms"): a skip means "not now", and
	 * persisting it would quietly turn indecision into a decision that outlives
	 * the sitting it was made in.
	 */
	skipped = new SvelteSet<string>();

	/**
	 * The subject on screen.
	 *
	 * Deliberately state, not a derivation of the queue. If it were derived,
	 * recording a decision would change the queue and the screen would move on
	 * its own — and later, background activity loading would reorder the queue
	 * under the user mid-read. It changes only when a user action or an empty
	 * screen calls `advance`.
	 */
	current = $state<FollowSnapshot | null>(null);

	/**
	 * What the last keep, unfollow, or skip was — the backing for the undo
	 * notice. Null once the notice is dismissed or the action is taken back.
	 */
	lastAction = $state<LastAction | null>(null);

	/**
	 * Everything done to a subject this sitting, oldest first.
	 *
	 * `lastAction` only ever held the most recent one, and it is cleared when
	 * the notice is dismissed or the action is taken back — so a second undo
	 * had nothing to dispatch on and fell through to the persisted decision
	 * stack. Skips are not on that stack, by design, so skipping three accounts
	 * and then undoing took back one and then silently did nothing.
	 *
	 * Session-only, like skips themselves (PRD, "Terms"). After a reload it is
	 * empty and undo falls back to the persisted stack, which is what makes
	 * decisions survive a closed tab while skips do not.
	 */
	private history: LastAction[] = [];

	private actionSeq = 0;

	undecided = $derived(this.subjects.filter((s) => !this.decisions.has(s.subjectDid)));
	remaining = $derived(this.undecided.filter((s) => !this.skipped.has(s.subjectDid)));
	skippedCount = $derived(this.undecided.filter((s) => this.skipped.has(s.subjectDid)).length);
	keptCount = $derived(this.countOf('keep'));
	markedCount = $derived(this.countOf('unfollow'));

	/**
	 * The subjects a run would act on.
	 *
	 * Read from the decision map rather than kept as its own list, so a keep
	 * recorded on the review screen removes the subject here without a second
	 * place to forget to update.
	 */
	marked = $derived(
		this.subjects.filter((s) => this.decisions.get(s.subjectDid)?.decision === 'unfollow')
	);

	/**
	 * The subjects that were kept, most recently decided first.
	 *
	 * Ordered by when the call was made rather than alphabetically: coming back
	 * after a sitting, the useful question is "what did I just decide", and the
	 * answer is at the top.
	 *
	 * Read from the decision map for the same reason `marked` is — a decision
	 * changed anywhere shows here without a second list to keep in step.
	 */
	kept = $derived(
		this.subjects
			.filter((s) => this.decisions.get(s.subjectDid)?.decision === 'keep')
			.sort((a, b) =>
				(this.decisions.get(b.subjectDid)?.decidedAt ?? '').localeCompare(
					this.decisions.get(a.subjectDid)?.decidedAt ?? ''
				)
			)
	);

	/**
	 * The period picked on the network screen.
	 *
	 * Held for the sitting only: it is a view setting, and not worth a change
	 * to what storage holds.
	 */
	networkPeriodChosen = $state<Period>(30);

	/** The chosen period, or the longest one the lookback still allows. */
	networkPeriod = $derived(offeredPeriod(this.networkPeriodChosen, this.settings.lookbackDays));

	/** Bumped by `refreshNetwork`, which is all that makes a scan's progress show. */
	#networkClock = $state(0);

	/**
	 * The network figures, from activity the scan has already loaded.
	 *
	 * The scanner's map is read untracked, so a scan landing a few subjects a
	 * second does not recompute every figure for every follow each time. The
	 * screen asks for a refresh on a clock instead.
	 *
	 * Accounts a run has already unfollowed are not followed now, whatever the
	 * snapshot still lists. Every other decision is irrelevant here: kept and
	 * marked accounts are both still followed.
	 */
	network = $derived.by(() => {
		void this.#networkClock;
		const follows = this.subjects.filter(
			(s) => this.decisions.get(s.subjectDid)?.decision !== 'unfollowed'
		);
		const period = this.networkPeriod;
		return untrack(() => computeNetworkStats(follows, this.scanner.states, period));
	});

	/** Pick up whatever the scan has loaded since the figures were last computed. */
	refreshNetwork(): void {
		untrack(() => this.#networkClock++);
	}

	private countOf(decision: Decision): number {
		let total = 0;
		for (const record of this.decisions.values()) if (record.decision === decision) total++;
		return total;
	}

	/**
	 * Build the OAuth client and pick up whatever state the page loaded with.
	 *
	 * One call covers both a redirect back from the authorization server and an
	 * ordinary reload with a live session, because the app is a single route and
	 * the callback lands on it. Browser-only, so it runs from `onMount`.
	 */
	async restore(): Promise<void> {
		try {
			this.client = await createOAuthClient();
			const restored = await restoreOwner(this.client);
			if (!restored) return;
			this.session = restored.session;
			await this.loadEverything(restored.session, { refetch: false });
		} catch (cause) {
			// A denied or failed authorization comes back through here, and the
			// reason is the only thing that tells the user what to do next
			// (PRD, AUTH-1).
			this.error = cause instanceof Error ? cause.message : String(cause);
			this.phase = 'signed-out';
		}
	}

	/**
	 * Hand off to the user's own authorization server.
	 *
	 * This navigates away, so nothing after it runs on success. The app comes
	 * back through `restore`.
	 */
	async signIn(handle: string): Promise<void> {
		const client = this.client;
		if (!client) return;

		this.error = null;
		this.phase = 'signing-in';
		try {
			await startSignIn(client, handle);
		} catch (cause) {
			this.error = cause instanceof Error ? cause.message : String(cause);
			this.phase = 'signed-out';
		}
	}

	/**
	 * Change the lookback or the gap threshold.
	 *
	 * A new lookback restarts the scan, because it changes which events exist.
	 * A new threshold does not, because it only decides which stretches are
	 * long enough to name (PRD, "Metrics").
	 */
	async updateSettings(next: Partial<Omit<Settings, 'ownerDid'>>): Promise<void> {
		const session = this.session;
		if (!session) return;

		const previous = this.settings;
		this.settings = { ...previous, ...next, ownerDid: session.did };
		await saveSettings($state.snapshot(this.settings));

		if (this.settings.lookbackDays !== previous.lookbackDays) {
			this.scanner.start(this.subjects, this.settings.lookbackDays);
		}
	}

	/**
	 * End the session with the authorization server, not just locally.
	 *
	 * Revoking is the part that matters: clearing app state alone leaves the
	 * tokens live in the library's store, and the next load would sign the user
	 * straight back in. Decisions stay — they are the user's, and signing out is
	 * not a request to forget them (PRD, AUTH-2).
	 */
	async signOut(): Promise<void> {
		const client = this.client;
		const did = this.session?.did;

		this.session = null;
		this.subjects = [];
		this.decisions.clear();
		this.skipped.clear();
		this.current = null;
		this.lastAction = null;
		this.history = [];
		this.error = null;
		this.phase = 'signed-out';

		if (!client || !did) return;

		try {
			await signOutOwner(client, did);
		} catch (cause) {
			// The screen already says signed out, and the local state is gone. But
			// a revoke that did not reach the server may leave the grant live, and
			// silently looking signed out while still being authorized is the one
			// version of this the user must not be left with.
			this.error =
				`Signed out here, but your server could not be reached to revoke the ` +
				`session: ${cause instanceof Error ? cause.message : String(cause)}. ` +
				`Revoke it from your account settings if that matters to you.`;
		}
	}

	/**
	 * Fill the screen and the queue.
	 *
	 * `refetch: false` uses the stored snapshot, so reopening a review does not
	 * re-read a few thousand follows to show the same list.
	 */
	private async loadEverything(
		session: OwnerSession,
		{ refetch }: { refetch: boolean }
	): Promise<void> {
		this.phase = 'loading';
		this.error = null;

		try {
			this.settings = await loadSettings(session.did);
			await this.meter.start(session.did);

			this.decisions.clear();
			for (const [subjectDid, record] of await loadDecisions(session.did)) {
				this.decisions.set(subjectDid, record);
			}

			let subjects = refetch ? [] : await loadFollows(session.did);

			if (subjects.length === 0) {
				this.progress = { step: 'Reading your follows', loaded: 0, total: null };
				const follows = await listFollows(session, (loaded) => {
					this.progress = { step: 'Reading your follows', loaded, total: null };
				});

				const subjectDids = follows.map((f) => f.subjectDid);
				this.progress = { step: 'Loading profiles', loaded: 0, total: subjectDids.length };
				const profiles = await getProfiles(subjectDids, (loaded) => {
					this.progress = { step: 'Loading profiles', loaded, total: subjectDids.length };
				});

				this.progress = {
					step: 'Checking who follows you back',
					loaded: 0,
					total: subjectDids.length
				};
				/*
				 * Follow-back status is a nice-to-have on the card, not a reason to
				 * fail a load that already has every profile — but the failure is
				 * recorded rather than swallowed. Without the note, a rejected
				 * lookup just means no card ever shows "follows you", and absence
				 * reads as "they do not follow you back", which is a different
				 * claim and one the reader would act on.
				 */
				// eslint-disable-next-line svelte/prefer-svelte-reactivity
				let followsOwner = new Map<string, boolean>();
				try {
					followsOwner = await getFollowsOwner(session.did, subjectDids, (loaded) => {
						this.progress = {
							step: 'Checking who follows you back',
							loaded,
							total: subjectDids.length
						};
					});
					this.followBackError = null;
				} catch (cause) {
					this.followBackError = cause instanceof Error ? cause.message : String(cause);
				}

				/*
				 * Counted where the numbers already are. `follows` is the
				 * owner's own repo, which X prices as an owned read; the other
				 * two are lookups of other people and are priced as such.
				 */
				this.meter.record('follows', follows.length);
				this.meter.record('profiles', profiles.size);
				this.meter.record('relationships', followsOwner.size);

				subjects = await saveFollows(session.did, follows, profiles, followsOwner);
			}

			this.subjects = subjects;
			this.scanner.onFetched = ({ posts, likes }) => {
				this.meter.record('posts', posts);
				this.meter.record('likes', likes);
				// Flushed per subject rather than per resource: a full review
				// fetches tens of thousands of them.
				void this.meter.flush();
			};
			this.scanner.start(subjects, this.settings.lookbackDays);
			await this.meter.flush();

			// An unfinished run outranks the queue: it already deleted records,
			// and leaving it half-done is the one state the user cannot see.
			await this.runs.findUnfinished(session.did);

			this.advance();
		} catch (cause) {
			this.error = cause instanceof Error ? cause.message : String(cause);
			this.phase = 'signed-out';
		}
	}

	/**
	 * Where a subject sits in the queue, lowest first (PRD, TRI-2).
	 *
	 * 0 — unavailable, or activity failed to load. The easiest calls to make,
	 *     and the ones a flat follow list buries.
	 * 1 — loaded, and silent for the whole covered window.
	 * 2 — loaded and active; ordered among themselves by how long ago.
	 * 3 — not loaded yet. "Next" is chosen from what has loaded, so a subject
	 *     the scan has not reached waits rather than jumping the queue on the
	 *     strength of knowing nothing about them.
	 */
	private rank(subject: FollowSnapshot): number {
		if (!subject.profile) return 0;
		const state = this.scanner.get(subject.subjectDid);
		if (state.status === 'error') return 0;
		if (state.status !== 'ready') return 3;
		return state.lastActive === null ? 1 : 2;
	}

	/** Put the next undecided subject on screen, least recently active first. */
	advance(): void {
		const next = [...this.remaining].sort((a, b) => {
			const byRank = this.rank(a) - this.rank(b);
			if (byRank !== 0) return byRank;

			const aLast = this.scanner.get(a.subjectDid).lastActive;
			const bLast = this.scanner.get(b.subjectDid).lastActive;
			if (aLast && bLast) return aLast.localeCompare(bLast);

			// Within a rank where neither has a last-active date, the oldest
			// follow goes first: it is the one most likely to have drifted.
			return (a.followedAt ?? '').localeCompare(b.followedAt ?? '');
		})[0];

		this.current = next ?? null;
		this.phase = next ? 'triage' : 'done';
		if (next) this.scanner.prioritize(next.subjectDid);
		if (!next && this.skipped.size === 0) void this.completePass();
	}

	/**
	 * Mark the moment the queue emptied with nothing left skipped.
	 *
	 * What makes a follow "new" on the next pass. Only a clean finish counts:
	 * stopping with accounts still skipped is a sitting that ended, not a
	 * review that finished, and dating the next pass from it would file the
	 * skipped backlog under "new".
	 */
	private async completePass(): Promise<void> {
		if (!this.session || this.subjects.length === 0) return;

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once, never held
		const finishedAt = new Date().toISOString();
		this.settings = { ...this.settings, lastPassCompletedAt: finishedAt };
		await saveSettings($state.snapshot(this.settings));
	}

	/**
	 * Followed since the user last finished a full pass.
	 *
	 * Before a first pass there is no such thing: everything is the backlog,
	 * and badging all of it would say nothing. A follow with no parseable date
	 * is not claimed to be new, because the honest answer is that we cannot
	 * tell.
	 */
	isNewSinceLastPass(subject: FollowSnapshot): boolean {
		const since = this.settings.lastPassCompletedAt;
		if (!since || !subject.followedAt) return false;
		return Date.parse(subject.followedAt) > Date.parse(since);
	}

	/** How many accounts in the queue arrived since the last finished pass. */
	newSinceLastPass = $derived(
		this.settings.lastPassCompletedAt
			? this.undecided.filter((subject) => this.isNewSinceLastPass(subject)).length
			: 0
	);

	/** Defer the subject on screen to the end of this sitting. */
	skip(): void {
		const subject = this.current;
		if (!subject || this.#acting) return;
		this.skipped.add(subject.subjectDid);
		this.noteAction('skip', subject);
		this.advance();
	}

	/** Name what just happened, so the undo notice can report and reverse it. */
	private noteAction(kind: LastAction['kind'], subject: FollowSnapshot): void {
		this.lastAction = {
			kind,
			subjectDid: subject.subjectDid,
			/*
			 * A display name is optional and may be blank; a handle is not —
			 * `Profile.handle` is a required string. So the only real absence
			 * here is having no profile at all, which is a deleted, deactivated
			 * or suspended account the user still follows (PRD, VIEW-2).
			 */
			label: subject.profile
				? subject.profile.displayName?.trim() || `@${subject.profile.handle}`
				: 'an account that could not be loaded',
			seq: ++this.actionSeq
		};
		this.history.push(this.lastAction);
	}

	/** Stop offering to take the last action back, without taking it back. */
	dismissLastAction(): void {
		this.lastAction = null;
	}

	/** Put the skipped subjects back in the queue. */
	reviewSkipped(): void {
		this.skipped.clear();
		/*
		 * Those skips are undone — by this, all at once — so taking one back
		 * afterwards would un-skip something already in the queue and jump the
		 * reader to it for no reason.
		 */
		this.history = this.history.filter((action) => action.kind !== 'skip');
		this.lastAction = null;
		this.advance();
	}

	async openSettings(): Promise<void> {
		const session = this.session;
		if (!session) return;
		this.phaseBeforeSettings = this.phase === 'settings' ? 'triage' : this.phase;
		this.phase = 'settings';
		this.pastRuns = await loadRuns(session.did);
		this.persisted = await requestPersistence();
	}

	closeSettings(): void {
		this.error = null;
		this.importReport = null;
		this.phase = this.phaseBeforeSettings;
	}

	/** The backup file's contents, for the user to save wherever they keep things. */
	async exportData(): Promise<string> {
		const session = this.session;
		if (!session) return '';
		return JSON.stringify(await exportOwner(session.did), null, 2);
	}

	/** Merge a backup back in, then reload what the screens read. */
	async importData(json: string): Promise<void> {
		const session = this.session;
		if (!session) return;
		this.error = null;
		this.importReport = null;
		try {
			this.importReport = await importOwner(json, session.did);
			await this.refreshDecisions();
			this.pastRuns = await loadRuns(session.did);
		} catch (cause) {
			this.error = cause instanceof Error ? cause.message : String(cause);
		}
	}

	/**
	 * Delete everything stored for this owner and start over.
	 *
	 * The caller confirms first (STORE-4). Nothing here is recoverable and none
	 * of it exists anywhere else, which is the whole point of the app.
	 */
	async deleteAllData(): Promise<void> {
		const session = this.session;
		if (!session) return;
		await deleteOwnerData(session.did);
		this.decisions.clear();
		this.skipped.clear();
		this.lastAction = null;
		this.history = [];
		this.pastRuns = [];
		this.runs.unfinished = null;
		this.settings = { ownerDid: session.did, ...DEFAULT_SETTINGS };
		this.meter.reset(session.did);
		this.advance();
	}

	/**
	 * Clear every decision and start the review again from the top.
	 *
	 * The narrow reset, and the one a user actually reaches for: it puts every
	 * followed account back in the queue without touching the follow list, the
	 * cached activity, the settings, or the run history.
	 *
	 * Accounts already unfollowed by a run do not come back. Their follow
	 * records are gone from the repo, so the next load will not list them at
	 * all, and the run that removed them is still the way back.
	 */
	async resetDecisions(): Promise<void> {
		const session = this.session;
		if (!session) return;

		await deleteDecisions(session.did);
		this.decisions.clear();
		this.skipped.clear();
		this.lastAction = null;
		this.history = [];
		this.identities = new IdentityProbe();

		/*
		 * Reloaded from the network, not from the snapshot.
		 *
		 * Starting the review again means looking at the accounts as they are
		 * now: handles change, accounts go dark and come back, and a follow
		 * list edited in another client has moved on. Re-reading the queue from
		 * a snapshot taken weeks ago would start the pass over against stale
		 * facts, which is the one thing a fresh pass is for.
		 */
		await this.loadEverything(session, { refetch: true });
	}

	/** Follow every account a past run unfollowed (PRD, RESTORE-1). */
	async restoreRun(run: RunRecord): Promise<void> {
		const session = this.session;
		if (!session) return;

		const subjectDids = run.targets.map((target) => target.subjectDid);
		await this.runs.restore(session, run, subjectDids);
		await this.refreshDecisions();
	}

	/**
	 * Go back to the account on screen.
	 *
	 * What the wordmark does. On the only route in the app, "home" is a phase
	 * change rather than a navigation, so this is not an anchor.
	 *
	 * The subject already on screen is kept when it is still undecided:
	 * `advance` re-sorts the queue, and background loading will have moved
	 * things since, so calling it unconditionally would swap the card for
	 * someone else purely because the user came back from settings.
	 */
	home(): void {
		if (this.current && !this.decisions.has(this.current.subjectDid)) {
			this.phase = 'triage';
			return;
		}
		this.advance();
	}

	/** Show the marked list, which is the last stop before anything is deleted. */
	review(): void {
		this.phase = 'review';
	}

	/** Leave the review screen for whatever is left to decide. */
	backToTriage(): void {
		this.advance();
	}

	/**
	 * Take a subject off the unfollow list from the review screen.
	 *
	 * The full undo stack is not involved: this is a correction made while
	 * looking at the list, not a decision being walked back one at a time.
	 */
	async keepInstead(subjectDid: string): Promise<void> {
		const session = this.session;
		if (!session) return;
		const record = await saveDecision(session.did, subjectDid, 'keep');
		this.decisions.set(subjectDid, record);
	}

	/**
	 * Mark a kept subject for unfollow after all, from the kept list.
	 *
	 * The mirror of `keepInstead`, and it skips the undo stack for the same
	 * reason: this is a correction made while reading a list, not a judgement
	 * being walked back one subject at a time.
	 */
	async unfollowInstead(subjectDid: string): Promise<void> {
		const session = this.session;
		if (!session) return;
		const record = await saveDecision(session.did, subjectDid, 'unfollow');
		this.decisions.set(subjectDid, record);
	}

	/** Show everything kept so far, so a second pass can be audited. */
	showKept(): void {
		this.phase = 'kept';
	}

	/** Show the cost comparison line by line, so the figure can be checked. */
	showCost(): void {
		this.phase = 'cost';
	}

	/** Show how the accounts followed now posted, this period against the one before. */
	showNetwork(): void {
		this.phase = 'network';
	}

	/** Delete the follow records for every marked subject. */
	async startRun(): Promise<void> {
		const session = this.session;
		if (!session) return;

		this.phase = 'running';
		await this.runs.startUnfollow(session, $state.snapshot(this.marked));
		await this.refreshDecisions();
	}

	/** Pick up a run that was interrupted by a closed tab or a dead network. */
	async resumeRun(): Promise<void> {
		const session = this.session;
		if (!session) return;

		this.phase = 'running';
		await this.runs.resume(session);
		await this.refreshDecisions();
	}

	/** Re-read decisions after a run has written `unfollowed` behind the UI's back. */
	private async refreshDecisions(): Promise<void> {
		const session = this.session;
		if (!session) return;
		this.decisions.clear();
		for (const [subjectDid, record] of await loadDecisions(session.did)) {
			this.decisions.set(subjectDid, record);
		}
	}

	/**
	 * Record a decision about the subject on screen, then move on.
	 *
	 * The write completes before the next subject appears. If it fails the
	 * subject stays put and the error is shown, because a decision the user
	 * believes was saved and was not is the one failure this app cannot have.
	 */
	async decide(decision: Extract<Decision, 'keep' | 'unfollow'>): Promise<void> {
		const subject = this.current;
		const session = this.session;
		if (!subject || !session) return;
		if (this.#acting) return;

		/*
		 * Already decided means this is a second press on a subject the screen
		 * has not moved off yet. Recording it again would put the same subject
		 * on the undo stack twice, and the second undo would then pop an entry
		 * whose decision is already gone and appear to do nothing.
		 */
		if (this.decisions.has(subject.subjectDid)) return;

		this.#acting = true;
		try {
			const record = await saveDecision(session.did, subject.subjectDid, decision);
			this.decisions.set(subject.subjectDid, record);
			this.error = null;
			this.noteAction(decision, subject);

			// Asked once, after the first decision: before that there is nothing
			// to lose, and a permission prompt with nothing behind it is noise.
			if (this.persisted === null && this.decisions.size === 1) {
				this.persisted = await requestPersistence();
			}

			this.advance();
		} catch (cause) {
			this.error = `Could not save that decision: ${cause instanceof Error ? cause.message : String(cause)}`;
		} finally {
			this.#acting = false;
		}
	}

	/**
	 * Take back the last thing the user did, whatever kind it was.
	 *
	 * A skip is not on the undo stack — it is session-only by design (PRD,
	 * "Terms") — so popping the stack after one would take back the decision
	 * *before* it and silently return the wrong account. Dispatching on what
	 * actually happened last is the only way "undo" means one thing.
	 */
	async undo(): Promise<void> {
		if (this.#acting) return;
		this.#acting = true;
		try {
			await this.#undo();
		} finally {
			this.#acting = false;
		}
	}

	async #undo(): Promise<void> {
		/*
		 * Dispatched on the sitting's history rather than on the notice, which
		 * is cleared when it is dismissed. A skip never reaches storage, so the
		 * only record that one happened is here.
		 */
		const last = this.history.at(-1);

		if (last?.kind === 'skip') {
			this.history.pop();
			this.skipped.delete(last.subjectDid);
			this.lastAction = null;
			this.current = this.subjects.find((s) => s.subjectDid === last.subjectDid) ?? this.current;
			this.phase = 'triage';
			return;
		}

		await this.undoDecision();
	}

	/** Take back the last decision and return to that subject. */
	private async undoDecision(): Promise<void> {
		const session = this.session;
		if (!session) return;

		const subjectDid = await undoLast(session.did);
		if (!subjectDid) return;

		this.decisions.delete(subjectDid);
		this.skipped.delete(subjectDid);
		this.lastAction = null;
		if (this.history.at(-1)?.kind !== 'skip') this.history.pop();

		this.current = this.subjects.find((s) => s.subjectDid === subjectDid) ?? this.current;
		this.phase = 'triage';
	}
}
