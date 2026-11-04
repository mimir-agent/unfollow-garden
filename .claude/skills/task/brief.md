# The brief

The brief is the agent half of the PR body: it sits in the collapsed block under
the human summary (`CLAUDE.md`, "Agent-authored output"). It is the handoff to a
fresh session that has no memory of the alignment conversation, so write it for
that reader, not for the human reviewing the PR.

**Success bar:** a fresh agent session, given only this file and
`SYSTEMS_MAP.md`, should start building the first slice without asking what the
goal is or where the boundary sits. If it couldn't, the brief isn't done.

## Where it lives

`tmp/BRIEF-<branch-slug>.md` at the worktree root — short kebab-case slug, ~30
chars. For an in-flight PR follow-up, `tmp/BRIEF-<PR-number>-<slug>.md`, with
the number from `gh pr view --json number -q '.number'`.

Create `tmp/` if it doesn't exist and gitignore the whole directory. Never
commit the brief — it is working context for this worktree, and the PR body is
the copy that outlives it. If the two diverge during the task, update the PR
body at land.

If the file already exists, don't overwrite it silently. Ask: a revision to
specific sections, or a restart?

## What you already have

Spend each fact once.

- **The alignment conversation** gave you goal, boundary, reversibility, and
  review posture. Don't re-interview.
- **`SYSTEMS_MAP.md`** gave you the relevant area. Read files it flags; don't
  re-derive the map.
- **The branch name** confirms scope.
- **A plan issue**, if this task is a cut from `/project-plan`, gave you this
  cut's stories. Start from those rather than proposing fresh ones.

## Sections

Seven, in order.

### 1. Context

The area as it exists today, from the systems map. Zero failure language — no
"doesn't," "fails to," "missing," "broken." If a sentence here describes
something going wrong, it belongs in Problem.

### 2. Problem

What the current state costs: time, errors, blocked work, risk. Not a
description of a failure — the price of it. "Test ownership is undiscoverable"
is a failure description; "engineers spend ~30 min/sprint finding which file
owns a failing case" is a problem.

### 3. Goal

Narrow, falsifiable, still true a week after merge. From alignment, verbatim if
it survived.

If Goal restates Problem in different words, stop and sharpen it. "Test failures
are easier to debug" restates the problem. "Every test failure names the owning
file path in its output, verifiable by reading any failure log" is a goal.

### 4. User stories

One line each: `<user> can <do X> and observes <Y>`.

Each becomes exactly one scenario test — the name and shape of it. Restraint
here is restraint everywhere downstream, because the story list is the test
list. Propose from the goal and the systems map, then confirm with the human.

### 5. Out of scope

Explicit boundaries, over-specified. This is what [STOP-2] checks against, so a
thin list produces either false stops or silent scope creep.

Two kinds belong here: what the goal doesn't claim, and what someone reading the
goal would reasonably assume it claims but it doesn't.

### 6. Seams and surface

Where the work lands. From targeted reading of files the systems map flags — if
the map doesn't cover the area, read just enough code to answer.

- **Seams** — the extension or swap points this work runs through, and whether
  it adds, changes, or closes any. This is the signal for the `/systems-map`
  update at land, so be specific.
- **Modified surface** — what exists and changes.
- **New surface** — what doesn't exist yet.
- **Fragile** — anything load-bearing here that isn't a declared contract
  ([CONTRACT-1]). If you checked and found none, say what you checked.

### 7. Open questions

Starts empty. Everything [STOP-4] queues lands here as the task runs:
uncertainties, things worth doing that aren't this task, decisions you made that
could reasonably have gone another way.

This section is what makes the closed stop-list affordable. If it's empty at
land on a task of any size, you probably interrupted instead of queuing, or
stopped noticing.

## Header

Above the sections, three lines from alignment:

```
**Reversibility:** <what's hard to undo, or "additive and revertible">
**Review posture:** <at the PR | before committing to an approach | at <step>>
**Plan issue:** <link, if this is a cut>
```

These are the facts a fresh session most needs and would otherwise have to
guess at.
