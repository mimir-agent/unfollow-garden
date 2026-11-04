# CLAUDE.md — unfollow-garden

Project rulebook. Read at task start.

## Project overview

unfollow-garden lets a Bluesky user review every account they follow, one at a
time, and decide whether to keep following it. Each account is shown with enough
context — bio, follow-back status, recent posts, replies, reposts, likes, and
how long its quiet stretches run — to make the call from one screen without
opening Bluesky.

Decisions live in the browser, so a review of a few thousand accounts can span
many sittings. When the review is done, the user signs in with atproto OAuth and
unfollows the marked accounts in one recorded, resumable, reversible run.

`PRD.md` is the spec. It owns the user stories, the activity-metric definitions,
and the storage schema; this file owns how work on it gets done. Where the two
disagree about product behaviour, the PRD wins.

**Two constraints shape everything:** no user data reaches a server, and every
unfollow is an individual decision. There is no server-side storage, no
rule-based bulk action, and no analytics. v0 runs locally with no server at
all; when a deployment returns it serves static assets and OAuth client
metadata, nothing else.

This project was forked from [suede](https://github.com/taurean/suede) at
`2026.7.3.3`; `package.json#suede.from` records the lineage. The process
pipeline below is suede's, tailored during kickoff.

## Stack

SvelteKit · Cloudflare Workers · Vitest + Playwright · pnpm · stylebase + Bits
UI · Storybook.

The app is client-rendered: `ssr = false`, and it deploys to
`https://unfollow.garden` on **Cloudflare Workers with static assets — always
Workers, never Pages**. The Worker serves files and headers and has no routes
of its own.

D1 and Drizzle were ripped at kickoff and persistence is IndexedDB in the
browser, per the PRD's no-server-storage constraint. Adding a database, a
backend, or a Worker route that receives user data is a decision to re-litigate
that constraint, not a wiring change.

**Authentication is atproto OAuth**, as a public browser client, scoped to
`atproto repo:app.bsky.graph.follow?action=create&action=delete` and nothing
else. The app never handles a credential: the user signs in on their own
authorization server, and the library holds DPoP-bound tokens in IndexedDB.
The app-password sign-in v0 shipped with is gone, along with `session.ts` and
the `bsky.social` entryway special case it needed.

Development runs on `http://127.0.0.1:5173`, never `localhost` — see
`CONTEXT.md`.

## Git workflow

- Always branch from `main`, and always from the **latest** `main`. The
  branch-from-`main` rule is only meaningful if the base commit is current —
  otherwise the branch silently forks from a superseded commit and the PR base
  vanishes the same way an in-flight branch does. Before creating the branch,
  fetch `origin`, base on `origin/main`, and verify the tree is clean.
- **Never branch off an in-flight branch.** The only base for a new branch is
  `main`. While a PR is open, new work either becomes a follow-up commit on the
  _same_ branch or waits. A branch-of-branch creates a PR whose base vanishes the
  moment the first PR merges.
- All tasks are reviewed in a pull request.
- **The agent may push branches and apply tags, but never merges to `main` and
  never pushes directly to `main`.** The human reviews and merges. Pushing a
  release branch and tagging the human's merge commit are both agent-OK; the
  merge itself is human-only.
- The human is the commit author for all commits. Agent-made commits add a
  `Co-authored-by:` trailer crediting the harness, so assistance is visible
  without tying the repo to one tool.

### Branch and commit naming

Branch names are `<type>/<slug>`, where `<slug>` is a short kebab-case
description. Commit messages are `<type>(<scope>): <subject>`, scope optional,
subject present-tense imperative ("add X", not "added X"). `chore(release):` is
reserved for the version-bump commit — see **Releases**.

**Canonical type list** (conventional-commits 1.0.0):

`feat` (new user-visible feature) · `fix` (bug fix for user-visible behaviour) ·
`chore` (maintenance, dependency bumps, tooling, version bumps) · `docs`
(documentation only) · `refactor` (neither fixes a bug nor adds a feature) ·
`test` (test additions or corrections) · `build` (build system or external
dependency) · `ci` (CI configuration) · `perf` (performance) · `style`
(formatting, no logic change).

The list is inherited from suede unchanged — kickoff recorded no override. The
[spec](https://www.conventionalcommits.org/en/v1.0.0/) is upstream; the list is
restated here so the agent doesn't fetch it on first use.

## Layout

- `CLAUDE.md` — this file
- `CONTEXT.md` — non-obvious constraints and gotchas unique to this project
- `SYSTEMS_MAP.md` — where things live and what changes together. Its Layout
  tree is the canonical repo map; this file doesn't duplicate it.
- `.claude/skills/` — in-repo skills. Directories are kebab-case, each with a
  `SKILL.md` and optional companion files (`task/brief.md`, `task/testing.md`).
- `.claude/agents/` — the reviewer agents and `story-test-writer`.
- `.claude/commands/` and `.claude/hooks/` — generated and maintained by
  `deciduous update`. Don't hand-edit.

Durable records of work: the `deciduous` decision graph in `.deciduous/`, the
project's tracker, and merged PR history. There is no per-task markdown note.

## Constant process pipeline

Inherited from suede and tailored at kickoff. Don't invent a new pipeline; if a
stage doesn't fit a task, compress it but keep the shape. No stage is compressed
for this project — the PRD's five release slices are multi-PR work, so stage 3
fires for real.

| Stage                                                             | Home                  | When                                                                                                     |
| ----------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------- |
| 1. **Concept** — in conversation, an issue, or a bug report       | —                     | Always; the input to the pipeline                                                                        |
| 2. **Align** on goal, boundary, reversibility, and review posture | `/task` step 1        | Every task. Short back-and-forth per `/poke-holes`                                                       |
| 3. **Cut plan**                                                   | `/project-plan`       | Only when the work cannot land as one PR. One plan issue with a cut checklist, never an issue per cut    |
| 4. **Build**                                                      | `/task`               | Every task: prep (worktree, systems map, brief, draft PR), then vertical slices with story-derived tests |
| 5. **Verify**                                                     | `/verify`             | Every task, before review. The app observed doing the thing, not a green suite                           |
| 6. **Review**                                                     | `/review`             | Four-axis review — Standards, Spec, Discipline, Legibility — in parallel subagents, before merge         |
| 7. **Release**                                                    | This file, "Releases" | Version bump as the final commit on the release branch; human tags the merge commit on `main`            |

**Always-on supporting layer** — not stages, they run throughout:

- **Engineering discipline** — the standing rules for fallbacks, slice hygiene,
  reversibility, dead code, failure messages, and when to stop and ask. Global,
  loaded automatically. Cited by rule ID in reviews.
- **Decision graph** — real-time logging, every commit linked to a node. See
  "Decision graph" below.
- **Git workflow** — this file's section above.
- **Authoring boundaries** — humans own design-token values, new primitive
  creation, and the visual contract; agents author markup and scoped CSS within
  it.

**Tracker.** **GitHub Issues** on `taurean/unfollow-garden` (private).
`/project-plan` publishes the plan issue there and `/review` reads specs from
it. Another git host may be added as a mirror, but is not a substitute for the
tracker.

## Authoring boundaries

**Humans own the design contract:**

- Design-token values — the `--hue-*`, `--space-*`, `--ff-*` definitions in
  stylebase.
- The visual contract — what the design is supposed to feel like.
- Architectural primitive decisions — which Bits UI primitives get wrapped, and
  whether a new primitive exists at all.

**Agents own implementation within that contract:**

- Svelte markup, using Bits UI primitives for any interactive element rather
  than raw HTML.
- `<style>` blocks and CSS in `src/lib/styles/`, drawing colour, spacing, and
  typography from stylebase properties and `u:` utilities.
- Layout, spacing, and typography — within the stylebase vocabulary.
- All TypeScript: `<script lang="ts">`, `*.ts` in `src/lib/` and `src/routes/`,
  the atproto and storage layers, API integrations, Workers.

**Hard constraints**, non-negotiable without the human:

- Don't redefine design tokens locally. If a stylebase property doesn't fit,
  flag it for the human to add at the source.
- Don't introduce a new UI primitive without explicit approval. Primitives shape
  the visual contract and ship with stories.
- Don't reach for raw HTML where a Bits UI primitive exists. The accessibility
  behaviour is the point of wrapping it.

Mechanics — which layer a rule goes in, which token, which primitive — are in
the `writing-css` skill. This section owns _who decides_; that skill owns _where
it goes_.

**Prototypes are the exception.** Throwaway variant components and prototype
routes may be agent-authored, provided they're clearly marked and deleted when
the prototype is done. Folding a winner into a real page is production markup
and the boundary applies again.

### Storybook discipline

A change to a UI primitive in `src/lib/components/` is **incomplete without a
story update in the same commit**. Stories are the agent-owned form of the
human-owned visual contract: the story captures the component's rendered states,
and any new state, prop, or visual branch added in code is a story-add or
story-edit. A primitive without a matching story is invisible to QA and to the
next contributor.

Storybook is retained for this project. The PRD's timeline strip has enough
rendered states — truncated window, hatched pre-account region, ongoing gap, no
events at all — that they need somewhere to be looked at side by side.

## Legibility

Most code here is generated, and it's read by people who weren't there when it
was written. Write for the time it takes someone unoriented to understand one
unit — a function, component, or route — and to debug it. People hold about four
half-understood ideas at once; every layer that makes them hold one more is a
cost.

This covers hand-written code: app code, tests, and stories. Not generated
files, lockfiles, config, or markdown.

### What reading a unit costs

- **Read cost** — the lines a reader actually reads to understand the unit: the
  unit itself plus every hop they have to follow. Shorter is better, until
  shortness makes code confusing, brittle, or opaque.
  - When **understanding**, a reader skips hops whose name and signature say
    what they do.
  - When **debugging**, names stop helping: the question is whether the code
    does what its name says. The reader follows every hop on the failing path,
    except ones they can check at the boundary.
- **Linearity** — how often a top-to-bottom read has to leave the unit. Code
  that needs a reading order explained isn't linear.
- **Name sufficiency** — whether a hop's name and signature predict what it
  does. A hop that does is free to a reader who's understanding, not debugging.
- **Hop depth** — how many hops a reader has to follow before reaching ground
  they already know: the language, the framework, or a well-known library. A
  name-sufficient hop isn't followed, so it doesn't count.
- **Concepts held open** — the most half-understood things a reader has to keep
  in mind at once.
- **Pass-through layer** — a layer that, inlined, would cost the reader nothing:
  a wrapper that forwards its arguments, a single-use helper whose name says
  less than its body, an options object with one caller.
- **Explicit boundary** — an extracted unit's inputs are its arguments, and its
  effects are its return value or named by it (`saveDraft`, not `process`). A
  hidden input is anything read from outside the arguments, except module-level
  `const` and imports from the framework or standard library. `getContext`,
  stores, and `$page` count as hidden. A unit with an explicit boundary can be
  checked from the call site — what went in, what came out — without stepping
  into it.

### Writing to it

- Extract only when the name lets a reader skip the body. Otherwise, inline.
- Keep inputs in the arguments. Read framework state (context, stores, `$page`)
  in the component or route, and pass the value down.
- Extend a pattern the codebase already has before introducing a new one.
- `const` by default; `let` only for a binding that's reassigned.

### What blocks merge

`/review`'s legibility reviewer blocks on:

- hop depth over 2;
- any pass-through layer;
- an extraction whose name doesn't predict what it does;
- an extraction with hidden inputs or unnamed effects;
- more than **3** new ideas in one PR without a reason in the PR body. A new
  idea is a new exported name or dependency, or the first instance of a pattern
  the codebase didn't have. A new module isn't counted apart from its exports:
  one file exporting one function is one idea. Forks tune the number here.

Read cost, linearity, and concepts held open are advisory: reported where
they're high, as findings, never as numbers. A diff over about 400 changed lines
of hand-written code is noted, never blocked.

## Working style

The pipeline table above says which skill applies at which stage. Load the
relevant one when the stage applies; don't load for the sake of loading.

In-repo skills (`.claude/skills/`):

- `task` — the task spine, user-invoked. `brief.md` owns the brief format;
  `testing.md` owns test quality and the prune pass.
- `project-plan` — cut plan for work too big for one PR. User-invoked.
- `review` — four-axis review, dispatching to the reviewer agents in
  `.claude/agents/`.
- `orient` — renders the current work unit as a visual page in `tmp/`.
  User-invoked.
- `writing-css` — CSS and component markup in stylebase + Bits UI. Loads
  automatically on `.svelte` and CSS files.
- `design` — visual design work against the human-owned contract.

Global skills ride in from the user's environment and are not enumerated here.
`engineering-discipline`, `poke-holes`, and `systems-map` are the ones this
pipeline depends on — `systems-map` is global rather than in-repo, since a
personal skill shadows a project skill of the same name.

`atprotocol-oauth` is the global skill for the OAuth work in slice 1. Load it
rather than deriving `@atproto/oauth-client-browser` setup from scratch; the
browser-app branch is the one this project needs.

`deciduous update` maintains its own commands and hooks under `.claude/`.

## Task flow

`/task` owns the sequence end to end — alignment, prep, build, verify, review,
closeout. Alongside it, the supporting layer applies throughout: decision-graph
logging in real time, authoring boundaries, and the co-authorship trailer.
Verification and release mechanics have their own sections below. The merge to
`main` is human-only.

## Agent-authored output

Everything an agent writes on GitHub — PR bodies, `/review` reports, closeout
comments — has two readers: the human deciding what to do, and the next agent
picking up the work. They need different things, so each gets its own part.

**The human summary comes first**, at most about ten lines. Lead with the
verdict: whether anything blocks, or what the human needs to decide. Then one
line per item they act on:

```
- What's wrong, in plain words. Fix: what to do. In `file.ts:42`.
```

The problem comes first, because it's what the reader needs to decide whether
to keep reading. Location comes last: a bare file name when it's unambiguous, a
path when it isn't, and every file named on its own — never a `{a,b}` set.
Labels a reader can skip, like a category or severity, go after the location in
parentheses.

Nothing goes in the summary that the human doesn't act on. If it runs past ten
lines and not every line is an action, detail has leaked in; move it down.

**Everything for agents goes below, collapsed:**

```
<details>
<summary>For agents</summary>

The brief, full reports, reasoning, evidence.

</details>
```

The blank lines inside the block are required; GitHub doesn't render markdown
without them.

| Surface                  | Summary                                                                     | Collapsed                  |
| ------------------------ | --------------------------------------------------------------------------- | -------------------------- |
| PR body                  | What changed, why, where the human's judgement is needed, verification line | The brief                  |
| `/review` report         | Verdict, then one line per blocking finding, synthesized across reviewers   | Each reviewer's raw report |
| `/task` closeout comment | Merge verdict, where to focus, one line per open question                   | Reasoning behind each      |

**Agent comments start with a marker** on their first line —
`<!-- suede:review -->` or `<!-- suede:closeout -->`. `/review` reads PR comments
as spec and skips any whose first line is a `suede:` marker, so a past review
never gets read as a requirement.

## Releases

This project uses [chronver](https://chronver.org). Version lives in
`package.json#version`, format `YYYY.M.D[.N][-feature|-break]`. `pnpm version`
normalizes leading zeros — `2026.6.4`, not `2026.06.04`.

Mechanics: every release branch ships as its own version bump; the bump is the
final commit before merge; the merge commit on `main` is tagged with the bare
version string, annotated, and pushed with `--follow-tags`; the changelog is
`git log <prev>..<new>`, with no `CHANGELOG.md`.

**No versionless merges.** Every branch ready to merge to `main` ships as its
own version.

### Cutting a release

1. Note in the release PR description whether the decision graph answered a
   question this cycle — a `/pulse` consulted, a past decision that prevented
   re-litigating. Several releases of "no" in a row is the evidence for demoting
   the graph to fork-optional. The record is the point of this line.
2. Final commit is `chore(release): cut <version>`. Bump with
   `pnpm version <version> --no-git-tag-version` and commit only the version
   field. Known gotcha: `pnpm version` rejects the four-segment `.N` form as
   invalid semver — hand-edit the manifests for a same-day second cut.
3. Tag the merge commit on `main` with the bare version string, annotated. Push
   with `git push origin main --follow-tags`.
4. `git log <prev>..<new>` is the changelog.

### Upstream lineage

`package.json#suede` carries `{ "from": "2026.7.3.3" }` — the chronver tag of
the suede commit this project branched from. It is a record, not a link: there
is no merge path back upstream, and suede moving on does not oblige this project
to follow.

## Decision graph

This project tracks decisions with `deciduous`. `deciduous update` writes and
maintains its own Decision Graph Workflow section in this file, along with the
commands and hooks under `.claude/`. It preserves custom content, so the house
conventions below sit alongside the generated section rather than replacing it.
Don't restate the generated mechanics here.

**Log in real time, not retroactively.** A pre-edit hook enforces this: an edit
is blocked unless a goal or action node was logged recently.

### What not to log

**The graph records the user's project decisions, not the agent's internal
process.** This is the rule that keeps the graph readable, and it's the one most
easily lost.

Do **not** create nodes for reading or exploring the codebase, your planning
process, tool usage, context gathering, or meta-commentary about starting work.

Do create nodes for what the user asked for (goals), concrete approaches being
considered (options), choices made between them (decisions), code being written
(actions), results (outcomes), and technical findings that affect decisions
(observations).

**Rule of thumb:** if a node describes something the user would put on a project
timeline or in a PR description, log it. If it describes the process of reading
and thinking, don't.

## Guardrails

Always:

- Run verification before claiming done.
- Capture verification results in the PR description.

Never:

- Edit markup or styles in a way the authoring boundaries forbid.
- Skip the PR description.
- Commit secrets.
- Widen the OAuth scope. It is
  `atproto repo:app.bsky.graph.follow?action=create&action=delete` and nothing
  else, defined once in `src/lib/atproto/client-config.ts`.
  `transition:generic` is never a fallback for an authorization server that
  rejects granular scopes — that failure is shown to the user, not worked
  around.
- Handle a credential in application code. The user authenticates on their own
  server; tokens belong to the OAuth library.
- Store user data on a server, or add analytics, telemetry, or a third-party
  script. Both are PRD non-goals, not preferences.
- Send an authenticated read. Every account lookup uses public endpoints; the
  OAuth session is for writes during runs only.

## Verification before completion

- `pnpm lint` — pass
- `pnpm check` — pass
- `pnpm test` — run if tests changed. The activity-metric definitions in
  `PRD.md` are unit tested independently of the UI; a change to them without a
  matching test change is incomplete.
- `/verify` — the app observed doing the thing. A green suite is necessary and
  not sufficient; tests written against code written in the same context share a
  common ancestor.
- On a release branch, the full Playwright journey suite runs before the version
  bump.

Claim done with evidence: command plus result.

<!-- deciduous:start -->

## Decision Graph Workflow

**THIS IS MANDATORY. Log decisions IN REAL-TIME, not retroactively.**

### Available Slash Commands

| Command           | Purpose                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `/decision`       | Manage decision graph - add nodes, link edges, sync                |
| `/recover`        | Recover context from decision graph on session start               |
| `/work`           | Start a work transaction - creates goal node before implementation |
| `/document`       | Generate comprehensive documentation for a file or directory       |
| `/build-test`     | Build the project and run the test suite                           |
| `/serve-ui`       | Start the decision graph web viewer                                |
| `/sync-graph`     | Export decision graph to GitHub Pages                              |
| `/decision-graph` | Build a decision graph from commit history                         |
| `/sync`           | Multi-user sync - pull events, rebuild, push                       |

### Available Skills

| Skill          | Purpose                                          |
| -------------- | ------------------------------------------------ |
| `/pulse`       | Map current design as decisions (Now mode)       |
| `/narratives`  | Understand how the system evolved (History mode) |
| `/archaeology` | Transform narratives into queryable graph        |

### The Node Flow Rule - CRITICAL

The canonical flow through the decision graph is:

```
goal -> options -> decision -> actions -> outcomes
```

- **Goals** lead to **options** (possible approaches to explore)
- **Options** lead to a **decision** (choosing which option to pursue)
- **Decisions** lead to **actions** (implementing the chosen approach)
- **Actions** lead to **outcomes** (results of the implementation)
- **Observations** attach anywhere relevant
- Goals do NOT lead directly to decisions -- there must be options first
- Options do NOT come after decisions -- options come BEFORE decisions
- Decision nodes should only be created when an option is actually chosen, not prematurely

### The Core Rule

```
BEFORE you do something -> Log what you're ABOUT to do
AFTER it succeeds/fails -> Log the outcome
CONNECT immediately -> Link every node to its parent
AUDIT regularly -> Check for missing connections
```

### Behavioral Triggers - MUST LOG WHEN:

| Trigger                       | Log Type           | Example                        |
| ----------------------------- | ------------------ | ------------------------------ |
| User asks for a new feature   | `goal` **with -p** | "Add dark mode"                |
| Exploring possible approaches | `option`           | "Use Redux for state"          |
| Choosing between approaches   | `decision`         | "Choose state management"      |
| About to write/edit code      | `action`           | "Implementing Redux store"     |
| Something worked or failed    | `outcome`          | "Redux integration successful" |
| Notice something interesting  | `observation`      | "Existing code uses hooks"     |

### What NOT to Log - CRITICAL

**The decision graph records the USER'S project decisions, not your internal process.**

Nodes should capture what the user is building, choosing, and accomplishing. Do NOT create nodes for your own thinking, planning, or tooling steps.

**DO NOT create nodes for:**

- Reading/exploring the codebase ("Analyzing project structure", "Reading config files")
- Your planning process ("Planning implementation approach", "Evaluating options internally")
- Tool usage ("Running tests to check status", "Checking git log")
- Context gathering ("Understanding existing auth code", "Reviewing PR comments")
- Meta-commentary ("Starting work on this task", "Preparing to implement")

**DO create nodes for:**

- What the user asked for (goals)
- Concrete approaches being considered (options)
- Choices made between approaches (decisions)
- Code being written or changed (actions)
- Results of implementation (outcomes)
- Technical findings that affect decisions (observations)

**Rule of thumb:** If a node describes something the user would put on a project timeline or in a PR description, log it. If it describes your internal process of reading and thinking, don't.

### Document Attachments

Attach files (images, PDFs, diagrams, specs, screenshots) to decision graph nodes for rich context.

```bash
# Attach a file to a node
deciduous doc attach <node_id> <file_path>
deciduous doc attach <node_id> <file_path> -d "Architecture diagram"
deciduous doc attach <node_id> <file_path> --ai-describe

# List documents
deciduous doc list              # All documents
deciduous doc list <node_id>    # Documents for a specific node

# Manage documents
deciduous doc show <doc_id>     # Show document details
deciduous doc describe <doc_id> "Updated description"
deciduous doc describe <doc_id> --ai   # AI-generate description
deciduous doc open <doc_id>     # Open in default application
deciduous doc detach <doc_id>   # Soft-delete (recoverable)
deciduous doc gc                # Remove orphaned files from disk
```

**When to suggest document attachment:**

| Situation                               | Action                                                         |
| --------------------------------------- | -------------------------------------------------------------- |
| User shares an image or screenshot      | Ask: "Want me to attach this to the current goal/action node?" |
| User references an external document    | Ask: "Should I attach a copy to the decision graph?"           |
| Architecture diagram is discussed       | Suggest attaching it to the relevant goal node                 |
| Files not in the project are dropped in | Attach to the most relevant active node                        |

**Do NOT aggressively prompt for documents.** Only suggest when files are directly relevant to a decision node. Files are stored in `.deciduous/documents/` with content-hash naming for deduplication.

### CRITICAL: Capture VERBATIM User Prompts

**Prompts must be the EXACT user message, not a summary.** When a user request triggers new work, capture their full message word-for-word.

**BAD - summaries are useless for context recovery:**

```bash
# DON'T DO THIS - this is a summary, not a prompt
deciduous add goal "Add auth" -p "User asked: add login to the app"
```

**GOOD - verbatim prompts enable full context recovery:**

```bash
# Use --prompt-stdin for multi-line prompts
deciduous add goal "Add auth" -c 90 --prompt-stdin << 'EOF'
I need to add user authentication to the app. Users should be able to sign up
with email/password, and we need OAuth support for Google and GitHub. The auth
should use JWT tokens with refresh token rotation.
EOF

# Or use the prompt command to update existing nodes
deciduous prompt 42 << 'EOF'
The full verbatim user message goes here...
EOF
```

**When to capture prompts:**

- Root `goal` nodes: YES - the FULL original request
- Major direction changes: YES - when user redirects the work
- Routine downstream nodes: NO - they inherit context via edges

**Updating prompts on existing nodes:**

```bash
deciduous prompt <node_id> "full verbatim prompt here"
cat prompt.txt | deciduous prompt <node_id>  # Multi-line from stdin
```

Prompts are viewable in the web viewer.

### CRITICAL: Maintain Connections

**The graph's value is in its CONNECTIONS, not just nodes.**

| When you create... | IMMEDIATELY link to...                  |
| ------------------ | --------------------------------------- |
| `outcome`          | The action that produced it             |
| `action`           | The decision that spawned it            |
| `decision`         | The option(s) it chose between          |
| `option`           | Its parent goal                         |
| `observation`      | Related goal/action                     |
| `revisit`          | The decision/outcome being reconsidered |

**Root `goal` nodes are the ONLY valid orphans.**

### Quick Commands

```bash
deciduous add goal "Title" -c 90 -p "User's original request"
deciduous add action "Title" -c 85
deciduous link FROM TO -r "reason"  # DO THIS IMMEDIATELY!
deciduous serve   # View live (auto-refreshes every 30s)
deciduous sync    # Export for static hosting

# Metadata flags
# -c, --confidence 0-100   Confidence level
# -p, --prompt "..."       Store the user prompt (use when semantically meaningful)
# -f, --files "a.rs,b.rs"  Associate files
# -b, --branch <name>      Git branch (auto-detected)
# --commit <hash|HEAD>     Link to git commit (use HEAD for current commit)
# --date "YYYY-MM-DD"      Backdate node (for archaeology)

# Branch filtering
deciduous nodes --branch main
deciduous nodes -b feature-auth
```

### CRITICAL: Link Commits to Actions/Outcomes

**After every git commit, link it to the decision graph!**

```bash
git commit -m "feat: add auth"
deciduous add action "Implemented auth" -c 90 --commit HEAD
deciduous link <goal_id> <action_id> -r "Implementation"
```

The `--commit HEAD` flag captures the commit hash and links it to the node. The web viewer will show commit messages, authors, and dates.

### Git History & Deployment

```bash
# Export graph AND git history for web viewer
deciduous sync

# This creates:
# - docs/graph-data.json (decision graph)
# - docs/git-history.json (commit info for linked nodes)
```

To deploy to GitHub Pages:

1. `deciduous sync` to export
2. Push to GitHub
3. Settings > Pages > Deploy from branch > /docs folder

Your graph will be live at `https://<user>.github.io/<repo>/`

### Branch-Based Grouping

Nodes are auto-tagged with the current git branch. Configure in `.deciduous/config.toml`:

```toml
[branch]
main_branches = ["main", "master"]
auto_detect = true
```

### Audit Checklist (Before Every Sync)

1. Does every **outcome** link back to what caused it?
2. Does every **action** link to why you did it?
3. Any **dangling outcomes** without parents?

### Git Staging Rules - CRITICAL

**NEVER use broad git add commands that stage everything:**

- ❌ `git add -A` - stages ALL changes including untracked files
- ❌ `git add .` - stages everything in current directory
- ❌ `git add -a` or `git commit -am` - auto-stages all tracked changes
- ❌ `git add *` - glob patterns can catch unintended files

**ALWAYS stage files explicitly by name:**

- ✅ `git add src/main.rs src/lib.rs`
- ✅ `git add Cargo.toml Cargo.lock`
- ✅ `git add .claude/commands/decision.md`

**Why this matters:**

- Prevents accidentally committing sensitive files (.env, credentials)
- Prevents committing large binaries or build artifacts
- Forces you to review exactly what you're committing
- Catches unintended changes before they enter git history

### Session Start Checklist

```bash
deciduous check-update    # Update needed? Run 'deciduous update' if yes
                          # (auto-checked every 24h if auto-update is on)
deciduous nodes           # What decisions exist?
deciduous edges           # How are they connected? Any gaps?
deciduous doc list        # Any attached documents to review?
git status                # Current state
```

### Multi-User Sync

Sync decisions with teammates via event logs:

```bash
# Check sync status
deciduous events status

# Apply teammate events (after git pull)
deciduous events rebuild

# Compact old events periodically
deciduous events checkpoint --clear-events
```

Events auto-emit on add/link/status commands. Git merges event files automatically.

<!-- deciduous:end -->
