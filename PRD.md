# Follow triage: product requirements

Status: draft for v1
Date: 2026-09-10
Owner: Taurean Bryant
Build base: a copy of suede (SvelteKit on Cloudflare)
Working name: Follow triage

## Summary

Follow triage lets a Bluesky user go through every account they follow, one at a time, and decide whether to keep following it. Each account is shown with enough context to make that call quickly: bio, avatar, whether they follow back, recent posts, replies, reposts and likes, how often they act, and when they last went quiet for a long stretch.

Decisions are stored in the browser so a review of a few thousand accounts can span many sittings. When the review is done, the user signs in with atproto OAuth and unfollows the marked accounts in one run. Every run is recorded, so any account in it can be re-followed later.

A working prototype exists (see "Prototype findings"). This document defines the version to build on suede for long-term maintenance.

**What is built today matches this document**, with one thing outstanding: the
app is not deployed, because the production origin is unchosen (open question
3). The v0 app-password stage is over — see "Version 0", kept as a record of
what it cost and how it was left.

## Problem

Follow lists drift. People stop posting, change what they post about, or move on, and the list keeps growing. Bluesky shows who you follow as a flat list with no activity context. Judging one account means opening the profile, scrolling, and guessing how active it is. Likes, which are most of some people's activity, aren't visible on other people's profiles at all.

That is a few minutes per account. At 800 follows it doesn't get done.

## Goals

1. For most accounts, the user can make a keep or unfollow call from one screen without opening Bluesky.
2. Review survives reloads, closed tabs, and days between sittings without losing a decision.
3. Unfollowing is deliberate and recoverable. Nothing is deleted until the user reviews the full list. An interrupted run can resume. A completed run can be reversed.
4. The app asks for the narrowest OAuth permission that covers its writes, and no data about the user leaves the browser except requests to atproto services.

## Non-goals for v1

- Syncing decisions across devices or browsers. Export and import cover moving between machines.
- Rule-based bulk actions, such as "unfollow everyone inactive for 90 days." Every unfollow is an individual decision.
- Managing lists, mutes, blocks, or followers.
- Suggesting accounts to follow.
- Any server-side storage of user data. The Cloudflare deployment serves static assets and OAuth client metadata only.
- Authenticated reads. All account data comes from public endpoints.

## Users

The primary user is the owner: an experienced Bluesky user following several hundred to a few thousand accounts, working on a desktop browser with a keyboard.

The app should work for any atproto account, including accounts on self-hosted PDSes, with nothing specific to bsky.social in the core flow. Mobile browsers must be usable but aren't the primary target.

## Terms

| Term           | Meaning                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Owner          | The signed-in account whose follows are being reviewed.                                                                 |
| Subject        | A followed account under review.                                                                                        |
| Follow record  | An `app.bsky.graph.follow` record in the owner's repo. One subject can have more than one.                              |
| Decision       | `keep` or `unfollow`, set by the user. `unfollowed` is set by the app after a run deletes the subject's follow records. |
| Skip           | Moves a subject to the end of the queue without deciding. Session-only by design.                                       |
| Lookback       | How many days of activity to load per subject. Default 365.                                                             |
| Gap threshold  | The minimum length of an inactive stretch worth flagging. Default 30 days.                                              |
| Covered window | The period the loaded activity fully accounts for. See "Activity metrics."                                              |
| Run            | One execution of unfollows, recorded with its targets and outcome.                                                      |

## User stories

Each story's acceptance criteria are its test list.

### Sign in

AUTH-1. The user signs in with their handle through atproto OAuth.

- Entering a handle starts the OAuth flow against the authorization server for that account's PDS, including self-hosted ones.
- The consent screen shows only the permission to create and delete follow records.
- After sign-in, the app knows the owner's DID and PDS from the session and never asks for the handle again on that browser.
- A denied or failed authorization returns to the sign-in screen with the error reason shown.

AUTH-2. The session persists until it expires or the user signs out.

- Reloading the page restores the session without a redirect.
- When the session can't be refreshed, the user is sent back through OAuth. The triage position and all decisions are unchanged afterward.
- Signing out revokes the session with the authorization server and clears tokens. Decisions stay unless the user deletes them separately (STORE-4).

### Loading follows

LOAD-1. After sign-in, the app loads every account the owner follows.

- Follows are read from the owner's repo, not the AppView's follow list. Deleted, deactivated, and suspended accounts are included.
- Profiles are loaded in batches of 25 and follow-back status in batches of 30.
- Progress text states the current step and counts.
- Accounts followed or unfollowed in another client since the last load are added or removed on the next load.

LOAD-2. Activity loads for every subject in the background while the user reviews.

- At most 4 subjects load at once.
- Activity is cached for 24 hours per subject and lookback value. A reload within that time makes no activity requests.
- One subject failing to load does not stop the others. The failure appears on that subject with the error message.
- Rate-limited requests (HTTP 429) wait and retry, and the loading indicator says it is waiting.

### Account view

VIEW-1. The triage screen shows one subject with:

- Avatar, display name, handle linked to the Bluesky profile, and bio with line breaks kept.
- Whether the subject follows the owner.
- Follower, following, and post counts, and the date the owner first followed them.
- The activity summary and timeline strip defined in "Activity metrics."
- The most recent posts, replies, reposts, and likes. Up to 8 of each for posts, replies, and reposts, and up to 10 likes. Each links to the post on Bluesky, and replies name who they reply to. Reposts and likes name the original author.
- A note on posts that carry images, video, a link card, or a quote.

VIEW-2. Subjects without a profile are shown as unavailable, with the DID and an explanation that the account may be deleted, deactivated, or suspended.

VIEW-3. If a subject's PDS can't be read, the view says likes couldn't be loaded and why. The summary states that gap figures count posts, replies, and reposts only.

### Triage

TRI-1. The user decides with the keyboard or buttons.

- Keys: `K` keep, `U` unfollow, `S` skip, `Z` undo. Keys are ignored while focus is in a text field or a modifier key is held.
- The decision is written to storage before the next subject appears. If the write fails, the subject stays on screen and the error is shown.

TRI-2. The queue shows the least recently active undecided subjects first.

- Unavailable subjects and subjects whose activity failed to load come before all others.
- A subject with no activity in the covered window sorts before any subject with activity.
- The subject on screen never changes because of background loading.
- While activity is still loading, "next" is chosen from what has loaded, and the header says the order will settle once loading finishes.

TRI-3. Undo reverses the last decision or skip and returns to that subject.

- The undo stack persists across reloads.
- Subjects whose follow records were already deleted by a run are removed from the undo stack.

TRI-4. When only skipped subjects remain, the user can review them again. When none remain, the screen offers the review step.

TRI-5. The header shows how many subjects are undecided, kept, and marked for unfollow, plus activity loading progress.

### Persistence

STORE-1. Decisions, the undo stack, settings, and run records persist in IndexedDB, keyed by owner DID.

STORE-2. The app requests persistent storage from the browser and shows the result in settings.

- If persistence is denied, settings shows a plain explanation of what that means and links to export.

STORE-3. Two tabs can't run the app for the same owner at once. A second tab shows a notice with an option to take over, which ends the session in the first tab.

STORE-4. Settings has a way to delete all stored data for the owner, with a confirmation step.

### Review and unfollow

RUN-1. The review screen lists every subject marked for unfollow with avatar, name, handle, and last-active time. Each can be switched to keep.

RUN-2. Starting a run creates a run record before any delete request.

- The record stores each target's DID, handle, display name, and follow record rkeys, read fresh from the owner's repo at run start.
- Targets with no follow record left are marked `unfollowed` without a request, since they were unfollowed elsewhere.

RUN-3. Deletes are sent with `com.atproto.repo.applyWrites` in batches of up to 100.

- After each batch, the run record and the affected decisions are updated before the next batch is sent.
- Progress shows follow records removed out of the total.

RUN-4. An interrupted run can resume. Causes include a closed tab, a network failure, or an expired session.

- On next load, an unfinished run is offered for resumption.
- Resuming re-reads the owner's repo and only deletes records that still exist.

RUN-5. The user can download the target list of any run as JSON.

### Restore

RESTORE-1. The runs screen lists past runs with date and target count. From a run, the user can re-follow all targets or chosen ones.

- Re-following creates a new follow record per subject.
- The screen states that re-followed accounts will be notified and that the original follow date is not recovered.
- Re-followed subjects get the decision `keep`.

### Revisiting a review

PASS-1. The user can see every account they have kept.

- The list shows each kept account with when it was kept, most recent first,
  and can be filtered by display name, handle, or DID.
- Any of them can be marked for unfollow from the list.

PASS-2. A finished pass is dated, so a later one can tell new follows from the
backlog.

- The date is recorded only when the queue empties with nothing skipped; a
  sitting that ends with a backlog is not a finished pass.
- A follow made after that date is counted and marked as new. Before a first
  finished pass, nothing is new.

PASS-3. Starting the review over clears decisions and the undo stack, and
reloads the follow list from the network. Cached activity, settings, and run
history survive. It is reachable without opening settings.

### What this would have cost elsewhere

COST-1. The app states what loading the user's own follows and their activity
would have cost bought from X's API, and that it was free on AT Protocol.

- Only resources that actually crossed the network are counted. Anything served
  from the browser's cache cost nothing and is not counted.
- An install whose data was already cached seeds its counts once from what is
  stored, so a review already done is not reported as free.
- The figure opens a breakdown: count, rate, and subtotal per kind of read,
  with the endpoint each came from named.
- The rate card carries the date it was last checked and links its source.
  Nothing is fetched from x.com at runtime.

This is a claim about another company's published prices, so it is dated,
sourced, itemised, and conservative where it is uncertain. It is not a goal of
the product; it is one sentence about why the product can exist.

### Reading elsewhere

LINK-1. The user chooses which web client profile and post links open in.

- The choice applies to handles, mentions inside a bio, and recent posts.
- Clients differ in how a URL names an account. A link that cannot be built for
  the chosen client — a bio mention on a client that needs a DID, before that
  handle has been resolved — falls back rather than being built wrong.

### Across all follows

NET-1. The user can see how many of the accounts they follow posted recently, and how that
compares with the period before. The figures and terms are defined in "Network metrics."

- The screen is reached from the links beside Settings, and only while signed in.
- The period is 7, 30, or 90 days, and 30 by default. A period is offered only when the
  lookback is at least twice its length. Otherwise the screen says how much lookback it needs
  and links to settings.
- Only accounts followed now are included, in both periods. Keep and unfollow decisions do not
  change which accounts are included.
- Counted accounts plus the accounts not counted for each reason (still loading, failed to load,
  unavailable) equal the number of accounts followed. Each reason is shown with its count.
- An account whose likes could not be loaded, but whose posts did, is counted.
- The headline gives the number and share of counted accounts that posted in the current period.
- Likes are not counted in any figure, and the screen says so.
- Posts per day are shown for both periods over the compared accounts, with the change as a
  signed percentage. When the prior period has no posts, no percentage is shown.
- The number of counted accounts left out of the comparison by the fetch limit is shown.
- The series shows the compared accounts' posts across both periods: 14 buckets of 1 day for
  7 days, 20 of 3 days for 30, and 20 of 9 days for 90. The prior period is the first half.
- The list shows every counted account that posted in the prior period and not in the current
  one, ordered by its prior-period count, most first, then by its last post, most recent first.
  Each links to the account in the chosen web client (LINK-1).
- No action applies to the list as a whole.
- Opening the screen or changing the period sends no network request. While activity is still
  loading, the figures update as accounts load and say how many accounts they are based on.

### Backup

BACKUP-1. The user can export decisions, settings, the undo stack, and run records to a versioned JSON file. The activity cache is not exported.

BACKUP-2. The user can import that file into the same owner account.

- A file for a different owner DID is rejected, and the error names both DIDs.
- When both sides have a decision for the same subject, the one with the later `decidedAt` wins.
- The import reports what it added, updated, and skipped.

## Activity metrics

These definitions are the contract for `activity-stats`. They are unit tested independently of the UI.

### Events

Each subject's posts, replies, reposts, and likes are merged into one timeline of events, each with a kind and a timestamp.

| Kind   | Source                                                      | Timestamp                                                         |
| ------ | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Post   | Author feed item without a reply reference or repost reason | Earlier of the record's `createdAt` and the AppView's `indexedAt` |
| Reply  | Author feed item whose record has a reply reference         | Same as post                                                      |
| Repost | Author feed item with a repost reason                       | The repost reason's `indexedAt`                                   |
| Like   | `app.bsky.feed.like` record in the subject's repo           | The record's `createdAt`                                          |

Posts use the earlier of the two timestamps, which is how the AppView orders author feeds. Backdated imports keep their claimed date, and future-dated posts can't sort ahead of real ones. Like records whose `createdAt` doesn't parse are dropped, since they can't be placed in time.

### Covered window

- The lookback start is now minus the lookback.
- The loading start is the later of the lookback start and the subject's account creation date.
- Each source (author feed, likes) loads at most 5 pages of 100. A source that hits the cap before reaching the loading start covers only back to its oldest item.
- The covered window starts at the latest of these starts and ends at load time. It is truncated when a page cap, rather than the lookback or account age, set the start.

Only events inside the covered window count toward any metric. Without this, a subject who likes 300 posts a day would look inactive before yesterday.

### Metrics

| Metric          | Definition                                                                                                                                                                                                                                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Last active     | The latest event time. Null if the window has no events.                                                                                                                                                                                                                                                                                                                              |
| Typical gap     | Median of the times between consecutive events, shown with the mean. The median leads because one long absence skews the mean. Needs at least 2 events.                                                                                                                                                                                                                               |
| Long gaps       | Every stretch without events that is at least the gap threshold. This includes the stretch from the last event to load time, marked ongoing. When the window is not truncated, it also includes the stretch from the window start to the first event. That stretch is marked "at least" if the window starts at the lookback boundary. If it starts at account creation, it is exact. |
| Latest long gap | The most recent long gap.                                                                                                                                                                                                                                                                                                                                                             |
| Counts          | Events per kind inside the covered window.                                                                                                                                                                                                                                                                                                                                            |

Changing the gap threshold recomputes metrics from cached events without refetching. Changing the lookback invalidates the cache.

### Timeline strip

The strip spans the full lookback. It has one row per kind, month boundaries,
and a caption stating what one mark covers.

**As built it differs from what follows:** each row is a run of fixed buckets —
one per five days at the default lookback, with a floor of 24 — rather than a
tick per event, and long gaps are not drawn as shaded bands. The bucketed form
is what has been in use; this paragraph records the difference rather than
pretending it away.

The part of the lookback outside the covered window is hatched and labeled
either "not loaded (fetch limit reached)" or "before the account existed." The
strip is the visual center of the account view.

### Network metrics

These definitions are the contract for `network-stats`. They are unit tested independently of
the UI, and they use the events and covered windows defined above. As everywhere in this
section, only events inside an account's covered window count.

Each account's periods are measured back from that account's own load time, the end of its
covered window. The current period is the last P days. The prior period is the P days before
that. Activity is cached for up to 24 hours, so two accounts' periods can be up to a day apart.

| Metric             | Definition                                                                                                                                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Counted accounts   | Accounts followed now whose activity has loaded. Accounts still loading, accounts whose activity failed to load, and accounts with no profile are not counted. They are counted separately by reason.                                                                                                         |
| Posted             | At least 1 post, reply, or repost in the period. Likes are not counted, because they never reach a follower's timeline and they come from third-party PDSes that can fail.                                                                                                                                    |
| Posted in period   | The counted accounts that posted in the current period, as a number and as a share of counted accounts.                                                                                                                                                                                                       |
| Compared accounts  | Counted accounts whose covered window starts at or before the start of the prior period, plus those whose window starts at account creation. An account whose window was truncated by a page cap after the prior period started is left out, and the number left out is shown.                                |
| Posts per day      | For the compared accounts, the posts, replies, and reposts in a period divided by P, for each period. The change is the signed percentage from the prior period to the current one. There is no change when the prior period has no posts.                                                                    |
| Series             | The compared accounts' posts, replies, and reposts across both periods in equal buckets: 14 of 1 day when P is 7, 20 of 3 days when P is 30, and 20 of 9 days when P is 90. Buckets are placed relative to each account's own load time and summed across accounts. Each period is a whole number of buckets. |
| Posted before only | Counted accounts with at least 1 post, reply, or repost in the prior period and none in the current one. Ordered by prior-period count, most first, then by last post, most recent first.                                                                                                                     |

The periods are 7, 30, and 90 days. A period is offered only when twice its length fits in the
lookback, so the prior period is never cut off by it.

Every figure is computed from activity already loaded for triage. The network view makes no
requests of its own.

## Data sources

All reads are public and unauthenticated. The AppView is `https://public.api.bsky.app`.

| Data                             | Endpoint                                                                    | Host                    |
| -------------------------------- | --------------------------------------------------------------------------- | ----------------------- |
| Owner's follow records and rkeys | `com.atproto.repo.listRecords` on `app.bsky.graph.follow`                   | Owner's PDS             |
| Profiles                         | `app.bsky.actor.getProfiles`, 25 per request                                | AppView                 |
| Follows the owner                | `app.bsky.graph.getRelationships`, 30 per request                           | AppView                 |
| Posts, replies, reposts          | `app.bsky.feed.getAuthorFeed` with `filter=posts_with_replies`              | AppView                 |
| Subject's PDS                    | DID document from `plc.directory`, or `/.well-known/did.json` for `did:web` | PLC or subject's domain |
| Likes                            | `com.atproto.repo.listRecords` on `app.bsky.feed.like`                      | Subject's PDS           |
| Liked post content               | `app.bsky.feed.getPosts`, fetched when the subject is displayed             | AppView                 |

Authenticated writes go through the OAuth session to the owner's PDS:

| Action    | Endpoint                                                                         |
| --------- | -------------------------------------------------------------------------------- |
| Unfollow  | `com.atproto.repo.applyWrites` with delete operations on `app.bsky.graph.follow` |
| Re-follow | `com.atproto.repo.applyWrites` with create operations on `app.bsky.graph.follow` |

## Authentication

### Decision: public browser OAuth client

Use `@atproto/oauth-client-browser` as a public client that runs entirely in the browser.

The alternative is a confidential client in a Cloudflare Worker. That brings longer sessions (up to 180 days instead of 14) at the cost of a signing key, a JWKS endpoint, server-side session storage, and a server in the request path for every write. This app writes only during runs and is used occasionally. A 14-day session that sometimes needs re-authorization costs less than operating that backend, and it keeps "no user data on a server" true.

### Decision: sign in first

Sign-in is the first screen. The OAuth flow asks for a handle anyway, so a separate handle field would duplicate it. The session also provides a verified DID and PDS, which removes the handle-resolution step and the bsky.social entryway special case the prototype needed. The cost is that the consent screen mentions follow deletion before the user has reviewed anything. The sign-in screen should explain that nothing is changed until the user starts a run.

### Scope

```
atproto repo:app.bsky.graph.follow?action=create&action=delete
```

`delete` covers unfollowing. `create` covers restore (RESTORE-1). Asking for both up front avoids a second consent flow the first time the user restores.

The app must not request `transition:generic`.

### Client metadata

- In production, `client_id` is `https://<deployed origin>/oauth-client-metadata.json`, served by the suede app. It sets `application_type: "web"`, `token_endpoint_auth_method: "none"`, `dpop_bound_access_tokens: true`, the scope above, and one redirect URI on the same origin.
- In development, use the loopback client: `client_id` of `http://localhost` with the scope and a `redirect_uri` on `http://127.0.0.1:<port>`. The app must be opened at `127.0.0.1`, not `localhost`. The library redirects automatically.
- The metadata is generated from one config module so the scope string exists in one place.

### Sessions

The OAuth library stores DPoP keys and tokens in its own IndexedDB database. App code never reads or stores tokens. All writes use the session's fetch handler, which targets the owner's PDS.

## Local storage

### Requirements

- Decisions survive reloads, browser restarts, and closed tabs.
- A decision is written before the UI treats it as saved.
- The schema can change without losing decisions.
- The user can get their data out, and back in, without the app.
- The app detects and states when storage might be evicted.

### Decision: IndexedDB through `idb`

IndexedDB is transactional, handles the data size (a few MB of cached activity for thousands of subjects), and has versioned upgrades built in. `idb` is a thin promise wrapper with typed schemas and no query layer to learn.

Alternatives considered:

- localStorage, used by the prototype. It is synchronous, limited to about 5 MB, has no transactions, and is evicted on the same terms as IndexedDB. Rejected.
- SQLite in WASM on OPFS. It adds a WASM download of about 1 MB and worker plumbing, and some storage backends need cross-origin isolation headers. The data has no relational queries that justify it. Rejected for v1.
- Records in the owner's atproto repo. Repo records are public, and a list of people someone plans to unfollow must not be. Rejected.
- Cloudflare D1. It would provide multi-device sync, but needs server-side auth and puts user data on a server, which contradicts goal 4. Deferred.

### Schema, version 1

Database name `follow-triage`. Keys that include the owner DID keep data for multiple accounts separate.

| Store       | Key                      | Value                                                                                                    |
| ----------- | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `settings`  | `ownerDid`               | lookbackDays, thresholdDays                                                                              |
| `decisions` | `[ownerDid, subjectDid]` | decision, decidedAt                                                                                      |
| `undo`      | `ownerDid`               | ordered list of subject DIDs                                                                             |
| `follows`   | `[ownerDid, subjectDid]` | profile snapshot, follow rkeys, first followed date, follows-owner flag, loadedAt                        |
| `activity`  | `subjectDid`             | events, recent entries, covered window, lookbackDays, fetchedAt, likes error if any                      |
| `runs`      | `id`                     | ownerDid, kind (`unfollow` or `refollow`), createdAt, status, targets with rkeys, completed rkeys, error |

`runs` has an index on `ownerDid`. Activity is not keyed by owner because it describes the subject, and sharing it between owners on one browser is harmless.

### Resilience measures

- Call `navigator.storage.persist()` after the first decision, and show the result in settings. Chromium grants it by heuristic. Firefox asks the user. Safari may clear script-written storage for sites not visited for 7 days, so settings recommends export for Safari users.
- Every schema change is a numbered migration in the upgrade handler. A migration may transform `decisions` and `runs` but never drop them. Each migration has a test that opens a database at the previous version with fixture data and checks the result.
- Decision writes and their undo-stack update happen in one transaction.
- Run progress is written per batch, so a crash loses at most one batch's bookkeeping, and resumption re-reads the repo to reconcile.
- Web Locks enforce one active tab per owner (STORE-3). A run holds its own lock for its duration.
- Export files carry `formatVersion`, `ownerDid`, and `exportedAt`. Import validates all three before touching storage.

## Architecture on suede

The app is client-rendered. Routes set `ssr = false`. The only server-generated output is `oauth-client-metadata.json`, which can be a static file per environment or a `+server.ts` route built from the configured origin. Adapt the module layout below to suede's conventions during kickoff.

```
src/lib/
  atproto/
    xrpc.ts            query/procedure helpers, 429 handling, error type
    identity.ts        DID document fetch, PDS lookup (subjects only)
    graph.ts           follow records, profiles, relationships
    activity.ts        author feed, likes, liked posts, event extraction
    oauth.ts           client setup, sign in/out, session restore
    writes.ts          batched follow deletes and creates
  stats/
    activity-stats.ts  metric definitions from this document
  storage/
    db.ts              schema, migrations, typed accessors
    backup.ts          export/import format and validation
    locks.ts           Web Locks wrappers
  triage/
    session.svelte.ts  queue, decisions, undo, background scan
    runs.svelte.ts     run creation, execution, resume, restore
  components/          sign-in, triage, account, activity panel, strip, review, runs, settings
```

Rules carried from the prototype:

- The subject on screen is state, set only by user actions and by filling an empty screen. It is never derived from the queue.
- Background loading writes to reactive state per subject (`SvelteMap`), not a deep-proxied object holding thousands of event arrays.
- Values written to IndexedDB are plain objects captured before entering reactive state, or passed through `$state.snapshot`. Svelte proxies can't be structured-cloned.
- Errors from third-party PDSes are shown on the affected subject. Errors from the owner's PDS or the AppView during loading stop the load and are shown on the loading screen.

## Interface

Screens: sign in, loading, triage, review, run progress, runs, settings, follows.

Visual direction:

- Group with whitespace, not borders, cards, or panels.
- No shadows or other depth effects.
- One typeface, chosen for legibility at small sizes. Numbers use tabular figures where they line up.
- The timeline strip carries the visual weight. Everything else is quiet.
- Keep and unfollow use distinct colors, and state is never conveyed by color alone.
- Light and dark schemes follow the system setting.

Quality floor: visible keyboard focus, reduced motion respected, WCAG AA contrast, usable at 360 px wide, and every action reachable without a pointer.

Copy uses sentence case and names actions by what they do: "Unfollow 42 accounts," then "Unfollowed 42 accounts." Errors state what failed and what to do next.

## Edge cases

| Case                                              | Behavior                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Duplicate follow records for one subject          | All rkeys are deleted in a run. The first followed date is the earliest record.                        |
| Follow record with unparseable `createdAt`        | Followed date is hidden. The record is still deleted in runs.                                          |
| Subject changed handle since last load            | Profiles reload each session, and runs store the handle at run time.                                   |
| Subject deleted between load and run              | Still unfollowed, since the follow record is in the owner's repo.                                      |
| Subject unfollowed in another client before a run | Marked `unfollowed` at run start with no request.                                                      |
| New follow added in another client                | Appears after the next load as undecided.                                                              |
| Stored decision for a subject no longer followed  | Kept in storage but excluded from counts and queue. Removed by "delete all data."                      |
| `did:web` subject whose domain is down            | Likes error on that subject. Posts still load from the AppView.                                        |
| Subject's PDS lacks CORS headers                  | Same as above.                                                                                         |
| Session expires mid-run                           | Run pauses as interrupted. After re-authorization it resumes (RUN-4).                                  |
| Owner's authorization server rejects the scope    | Sign-in shows the server's error and the requested scope. No broader scope is requested automatically. |
| Very large follow count (5,000+)                  | The first load takes several minutes. Triage starts as soon as the first subjects load.                |

## Performance and limits

- Per subject, the first load makes 1 PLC request, 1 to 5 author feed requests, and 1 to 5 like requests. A typical account needs about 3 requests.
- Scan concurrency is 4 subjects. For 1,000 follows, expect roughly 3,000 to 4,000 requests spread over the AppView, PLC, and many PDSes.
- On 429, wait until the `RateLimit-Reset` header's time when the browser can read it, otherwise 30 seconds, for up to 4 retries per request.
- Account view renders under 100 ms from cached data. Timeline ticks are capped at 1,000 per subject by the page limits.

## Privacy and security

- No analytics, telemetry, or third-party scripts.
- Data leaves the browser only as requests to the AppView, PLC, subjects' PDSes, and the owner's PDS and authorization server.
- Tokens are DPoP-bound and managed by the OAuth library. App code never handles credentials.
- The deployed app sends a Content Security Policy. `connect-src` must allow any HTTPS origin, because subjects' PDSes are arbitrary hosts.
- Decisions and runs never leave the browser except through a user-initiated export.

## Version 0: local build

**Closed.** v0 existed to get the triage loop in front of a real follow list
quickly, before OAuth. It is kept here as a record rather than deleted, because
the trade it made is the reason the scope discipline in "Authentication" is
written the way it is.

The storage schema, the metric definitions, and the user stories were unchanged
throughout, which is what made leaving v0 an auth swap rather than a rewrite.

### What differs from the rest of this document

| Area                    | v1 as specified                                       | v0 as built                                                             |
| ----------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| Authentication          | atproto OAuth, scoped to follow records               | App password, via `com.atproto.server.createSession`                    |
| Credential lifetime     | DPoP-bound tokens held by the OAuth library           | Session tokens in `sessionStorage`, gone when the tab closes            |
| Deployment              | Cloudflare, serving static assets and client metadata | None; `pnpm dev` on the developer's machine                             |
| Content-Security-Policy | Sent as a response header                             | Not sent; there is no server to send it                                 |
| PDS routing             | Handled by OAuth                                      | Bluesky-hosted accounts must authenticate at the `bsky.social` entryway |

### What v0 costs

**An app password grants full account access.** It can read direct messages,
post, and delete anything in the repo. The OAuth scope planned for v1 grants
only the creation and deletion of follow records, and that narrowness is a
large part of why this app is defensible at all — it asks to delete follows and
can honestly say it can do nothing else.

Nothing in v0 uses more than follow access. But the credential permits it, so:

- v0 is for the author's own account on the author's own machine.
- v0 is not deployed, and deploying it would be a decision to hand strangers a
  full-access credential prompt.
- The app password is used once at sign-in and never stored. Only the returned
  session tokens are kept, and only for the life of the tab.

**The bsky.social entryway special case returns.** A Bluesky-hosted account's
DID document names a PDS like `shiitake.us-east.host.bsky.network`, but those
hosts do not authenticate anyone — `createSession` has to go to
`https://bsky.social`. Sending credentials to the PDS host fails in a way that
reads as a wrong password. OAuth removes this distinction, which is one of the
reasons v1 moves to it. Implemented in `pdsForLogin` and unit tested.

### Leaving v0 — what actually happened

`src/lib/atproto/session.ts` was deleted and `src/lib/atproto/oauth.ts` took its
place; `oauth-client-metadata.json` returned as a prerendered route reading
`PUBLIC_APP_ORIGIN`; and the entryway special case in `pdsForLogin` was deleted
rather than carried forward, along with the `procedure` helper and the
`accessJwt` parameter in `xrpc.ts`, both of which had no remaining caller once
writes moved to the session's DPoP fetch.

Two things went differently from the plan above:

- **The Cloudflare adapter did not return.** The app is still a static bundle,
  which is all it ever needed to be. The Content-Security-Policy is therefore
  still absent and still waiting on a deploy, whatever host that ends up being.
- **Reading the owner's own follow records became unauthenticated.** It was an
  authenticated read in v0 out of habit; `listRecords` is public, and leaving it
  authenticated would have forced a wider scope for no gain.

The storage schema needed no migration, as expected.

## Release slices

Each slice ships on its own and leaves the app usable.

1. OAuth sign-in, loading follows and profiles, a basic account view, and decisions persisted in IndexedDB. This slice includes the storage schema, migration harness, and Web Locks.
2. Activity loading, stats, the timeline strip, recent items, and the activity cache.
3. Queue ordering, undo persistence, skip, and storage persistence status.
4. Review, unfollow runs with resume, and run list download.
5. Restore from runs, export and import, and delete all data.

## Risks

- Authorization servers on older self-hosted PDSes may not support granular scopes. Those users can't sign in until their PDS updates. A silent fallback to `transition:generic` is ruled out. If this blocks real users, handle it as an explicit, visible choice.
- Some PDSes don't send CORS headers, so likes are missing for their accounts. The UI states this per subject, so decisions aren't made on silently partial data.
- Public AppView rate limits are per IP and may change. The 429 handling bounds the damage, but a first scan of several thousand follows could take a long time.
- Safari's storage eviction can erase decisions for users who don't return within a week. Export is the mitigation, and settings says so.
- Re-follows notify the subject. Restore is a real undo for the follow graph but not an invisible one, and the UI must say that before acting.

## Open questions

1. Should restore ship in v1? It is why the scope includes `create`. If restore moves to a later version, drop `create` from the scope and accept a second consent flow later.
2. Should the review queue support filters, such as "doesn't follow me" or "inactive 90+ days," as a way to order work? This would still require individual decisions. Leaning toward a later version.
3. ~~Where will this deploy, and under what name?~~ **Answered:** `https://unfollow.garden`, on Cloudflare Workers with static assets — always Workers, never Pages, for this project. The Worker serves files and headers and has no routes of its own. The origin is baked in at build time by `pnpm build:deploy`. `www` must redirect to the apex or `client_id` will not match what the authorization server fetched — see `CONTEXT.md`.

## Prototype findings

The prototype (SvelteKit, client-only, app-password auth) was exercised in a browser against mocked endpoints. The mocks covered queue order, keyboard triage, undo, duplicate follow records, a failing third-party PDS, and batched deletes. The metrics definitions above match its tested behavior.

Confirmed against the live network since:

- **bsky.social accepts the granular scope.** A pushed authorization request
  carrying `atproto repo:app.bsky.graph.follow?action=create&action=delete`
  returns a `request_uri` and reaches the consent screen. The risk below about
  granular-scope support is therefore not a Bluesky-hosted problem; it remains
  open for older self-hosted PDSes.
- The loopback `client_id` form is accepted for local development, so no
  hostname is needed to work on this.
- **The whole loop runs against a real account.** Sign-in completes, follows
  and activity load, and a run deletes follow records. Exercised by the author
  on their own account.

Still not confirmed against the live network:

- `app.bsky.graph.getRelationships` works without auth on the public AppView.
- `com.atproto.repo.listRecords` returns newest first by default on current PDS versions.
- CORS behavior of third-party PDSes in practice, beyond the accounts the
  author happens to follow.
- Behaviour at the scale the performance section assumes: several thousand
  follows, and the rate limits a first scan of that size would meet.

OAuth removes one prototype assumption entirely: routing app-password sessions for `*.host.bsky.network` accounts through the bsky.social entryway.

What changes from the prototype:

- App passwords are replaced by OAuth with a scope limited to follow records.
- localStorage is replaced by versioned IndexedDB with export and import.
- Runs are recorded, resumable, and reversible.
- The undo stack persists.
- One active tab per owner is enforced.
