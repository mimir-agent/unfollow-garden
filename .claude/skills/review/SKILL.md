---
name: review
description: Review the changes since a fixed point along four axes — Standards (does it follow this project's documented conventions?), Spec (does it do what was asked?), Discipline (does it follow the standing engineering rules?), and Legibility (can someone unoriented understand and debug it?). Runs all four in parallel subagents and synthesizes one review that says whether anything blocks merge. Use when the user wants to review a branch, a PR, work-in-progress changes, or asks to "review since X".
argument-hint: [fixed-point]
allowed-tools: Bash(git diff:*) Bash(git log:*) Bash(git merge-base:*) Bash(gh pr view:*) Bash(gh pr comment:*) Bash(gh issue view:*) Read Grep Glob Task
---

# Review

Four-axis review of the diff between `HEAD` and a fixed point:

- **Standards** — does the code follow this project's documented conventions?
- **Spec** — does the code do what the originating spec asked for?
- **Discipline** — does the code follow the standing engineering rules?
- **Legibility** — can someone who has never seen the codebase understand and
  debug it?

Each axis runs as a subagent with its own context. The isolation is the point:
one axis must not be able to mask another, and a reviewer that has read every
set of sources will weigh them against each other instead of reporting
each cleanly.

## 1. Pin the fixed point

Whatever the user said is the fixed point — a commit SHA, branch name, tag,
`main`, `HEAD~5`. Don't be opinionated; pass it through. `$ARGUMENTS` carries it
when supplied.

When invoked from the task process at share, the fixed point is the branch's
merge-base with `origin/main` — don't ask. Otherwise, if none was given, ask
"Review against what — a branch, a commit, or `main`?" and don't proceed
without it.

Capture two things, once:

```
git diff <fixed-point>...HEAD      # three-dot: compares against the merge-base
git log <fixed-point>..HEAD --oneline
```

Pass the diff _command_ to the subagents, not its output. They run it
themselves. Reading the diff into this context before dispatching defeats the
isolation and costs you the context you need for aggregation.

## 2. Identify the spec source

In order:

1. The open PR's body and comments (`gh pr view --comments`) — the task process
   puts the brief in the body's collapsed block, and the brief's user stories
   are the spec. Skip any comment whose first line is a `<!-- suede:… -->`
   marker: that's agent output, such as an earlier review, not a requirement.
2. Issue references in the commit messages (`#123`, `Closes #45`) — fetch with
   `gh issue view <number>`. A plan issue found this way holds the cut's
   stories.
3. A path the user passed as an argument.
4. A spec file under `docs/`, `specs/`, or `.scratch/` matching the branch name.

If nothing is found, ask the user where the spec is. If they say there isn't
one, skip the Spec axis and say so in the report — an unreviewed axis is a
result, not a silence.

## 3. Identify the standards sources

Collect paths, don't read them. The Standards subagent reads its own sources.

- `CLAUDE.md`
- `CONTRIBUTING.md`
- `CONTEXT.md`, `CONTEXT-MAP.md`, per-context `CONTEXT.md` files
- `docs/adr/` — architectural decisions are standards
- Any `STYLE.md`, `STANDARDS.md`, `STYLEGUIDE.md` at the root or under `docs/`
- `.editorconfig`, `eslint.config.*`, `biome.json`, `prettier.config.*`,
  `tsconfig.json` — pass these too. The subagent reads them to know what
  tooling already covers, so it doesn't re-report what the linter catches.

## 4. Dispatch

Issue all four Task calls **in a single message** so they run concurrently.
Each agent carries its own brief in `.claude/agents/<name>.md`, so pass inputs
only.

| Agent                 | Inputs                                                   |
| --------------------- | -------------------------------------------------------- |
| `standards-reviewer`  | diff command, commit list, standards-source paths        |
| `spec-reviewer`       | diff command, commit list, spec path or fetched contents |
| `discipline-reviewer` | diff command, commit list                                |
| `legibility-reviewer` | diff command, commit list, path to `CLAUDE.md`           |

`discipline-reviewer` loads the `engineering-discipline` skill itself — don't
paste rules into its message. `legibility-reviewer` reads only the Legibility
section of `CLAUDE.md` — it reviews cold, as a developer meeting the code for
the first time, so it gets no spec and no other docs.

Pass nothing beyond the table. No summary of the change, no hint about what you
expect them to find, no note about which files you think matter. Each of those
is a way for your reading to contaminate theirs.

If there is no spec, dispatch three.

## 5. Aggregate

Lead with the verdict. The reader needs to know whether to act before they need
to know what was found.

**A finding blocks merge if it is any of:**

- labelled `MUST` by Discipline;
- labelled `wrong` or `missing` by Spec;
- labelled `hard` by Standards;
- labelled `block` by Legibility, except `new-ideas`, which blocks only when the
  PR body gives no reason for the count. The reviewer is cold and can't see the
  PR body, so check it here: a reason in the body turns that finding into a
  non-blocking one, and the summary says so.

Everything else — `SHOULD` violations with no stated reason, `judgement` calls,
`unasked` behavior, story/test `mismatch` findings, Legibility's `advise`
findings, open questions — is worth reading and does not block.

The report follows `CLAUDE.md`, "Agent-authored output": one synthesized review
for the human, and the reviewers' raw reports collapsed for agents.

```
<!-- suede:review -->
**<N> blocking, <M> non-blocking.** <one line naming the worst finding, or
"Nothing blocks merge.">

- What's wrong. Fix: what to do. In `file.ts:42`.
- What's wrong. Fix: what to do. In `other.ts:7`.

<details>
<summary>For agents</summary>

### Standards

<the subagent's report, verbatim>

### Spec

<...>

### Discipline

<...>

### Legibility

<...>

</details>
```

The human gets one review, not four reviewers. Write the summary from the
reports, without reviewer names or labels:

- **Every blocking finding gets a line**, most consequential first. They all
  stay, even past the usual ten-line summary; each one is something the human
  has to act on. Non-blocking findings appear only as the count in the verdict.
- **Findings about the same problem become one line**, and that line keeps
  every reason it was raised. Overlap is signal. A defensive branch no story
  describes comes back from Spec as unasked and from Discipline as
  `[FALLBACK-6]`; the merged line says it's both unrequested and an unnamed
  fallback, because the two readings disagree about what to do with it.
- **Merging never drops or softens a blocking finding.** If two findings can't
  share a line without losing a reason, leave them as two.
- **Reword only to merge or to clarify.** What's wrong and the fix stay what the
  reviewer said.

The collapsed block holds each report verbatim, so any summary line can be
traced to where it came from. A reviewer that found nothing still gets its
section saying so — dropping it makes the reader wonder whether it ran — and a
skipped Spec axis gets a section saying why.

## 6. Deliver

Check for an open PR on the current branch:
`gh pr view --json number,state -q 'select(.state == "OPEN") | .number'`.

**With an open PR**, post the report as a new comment:
`gh pr comment <number> --body-file -`, with the report on stdin. Each run posts
a new comment rather than editing the last, so the PR keeps the history of what
each review found. In the terminal, show only the verdict line, the blocking
lines, and the comment URL `gh` prints.

**Without one** — reviewing work in progress — print the report to the terminal.
`<details>` doesn't render there, so drop the marker and the `<details>`
wrapper, and print the raw reports under a `## For agents` heading.

## Why four axes

A change can pass one and fail another:

- Follows every convention, implements the wrong thing → Standards pass, Spec
  fail.
- Does exactly what was asked, wrapped in fallbacks that will hide the next
  three failures → Spec pass, Discipline fail.
- Disciplined and correct, ignores the project's own decisions → Discipline and
  Spec pass, Standards fail.
- Correct, disciplined, and conventional, but four layers deep with a helper
  that reads hidden state → the other three pass, Legibility fails. It's the
  axis the generating agent is least able to check for itself, because the
  context that added a layer is the one that thinks the layer is justified.

Reviewing them in separate contexts is what stops one from masking another.
The synthesis happens after each has reported, so it can't undo that.
