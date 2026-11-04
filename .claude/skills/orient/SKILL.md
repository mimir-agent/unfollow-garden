---
name: orient
description: >
  Render the current work unit — brief, branch diff, and review reports — as a
  self-contained visual page in tmp/: diagrams, schemas, endpoints, annotated
  code, and decisions pinned where they apply. User-invoked.
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/build.mjs:*) Bash(git log:*) Bash(git diff:*) Bash(git status:*) Bash(gh pr view:*)
---

# Orient

Produce `tmp/VISUAL-<slug>.html`: one read-only page someone can open cold,
offline, and come away knowing what this work is for, what was decided and why,
and where it lives. The slug is the branch name after its `<type>/` prefix;
when the branch has no such prefix, it's the whole branch name with `/` turned
into `-`.

You write data, not HTML. Put the page in `tmp/VISUAL-<slug>.json`, then run
`node ${CLAUDE_SKILL_DIR}/build.mjs tmp/VISUAL-<slug>.json`. The script checks
the data against a fixed block catalog, renders it, and inlines styles and
screenshots into the HTML file next to it. `node ${CLAUDE_SKILL_DIR}/build.mjs
--schema` prints the page shape and every block with an example; read it before
writing data.

The page is a view, never a record. Everything on it comes from a source that
already exists, and it is regenerated whole each run, so overwrite both files
without asking. When something belongs on the page but has no source, say so
on the page; never fill the gap.

## 1. Gather the sources

The work unit is the whole branch, not the last change.

- **The brief:** `tmp/BRIEF-<slug>.md`, or `tmp/BRIEF-<PR>-<slug>.md` for a PR
  follow-up (`task/brief.md`, "Where it lives").
- **The change:** `git log origin/main..HEAD --oneline`,
  `git diff origin/main...HEAD --stat`, and `git status --short` for work not
  yet committed. Uncommitted files are part of the work unit. Read the full diff
  of any file whose lines a block shows or a decision quotes; a deleted file
  needs only its stat. Removed text is a source too: what a change deletes is
  often what a decision beat.
- **The PR:** `gh pr view <number> --json number,state,body,comments`. Use the
  number the human gave; otherwise `gh pr view --json number` finds the PR for
  the current branch, and "no pull requests found" means there isn't one, so
  skip it. Any other failure means the PR is missing: list it and why. State
  matters: a closed or superseded PR says so in `summary`. The PR summary's
  action lines are open items unless the PR's state has made them moot. Review
  findings are in comments whose first line is `<!-- suede:review -->`.
- **This conversation:** decisions made here and not yet written down.

`sources.read` and `sources.missing` name sources in a few words each ("brief",
"PR #12", "review"), never explanations. A fact the page needs that no source
records goes in `open`, phrased as the question it leaves: "Why was the graph
dropped? Nothing records it."

`stage` and `slices` come from the brief and PR when the work runs under
`/task`: the stage it has reached, and the slices it planned. Leave both out
when nothing says, or when the PR is closed.

## 2. Choose the blocks

Pick blocks by what the change contains, not by habit. A small change gets a
short page.

| The change…                                | Block                                |
| ------------------------------------------ | ------------------------------------ |
| moves data or calls across parts           | `flow`                               |
| adds or alters routes                      | `endpoints`                          |
| adds or alters a schema or durable type    | `model`                              |
| hinges on a few lines a reviewer must read | `code`, with notes on those lines    |
| changes what a screen looks like           | `compare`, before (`main`) and after |
| touches more than a handful of files       | `files`, `lines` as `+12 −3`         |
| needs a fact no block can show             | `note`, one short paragraph          |

**Say each fact once.** Before adding a block, check whether another block
already shows it. A ruled-out option is a `ruled-out` node in the flow, not
also a chip and a decision line; the out-of-scope list goes in `out` and
nowhere else.

**Decisions attach to the block they shape**, through that block's
`decisions`. In a flow, set `on` to the node it concerns so the pin lands
there. A decision needs `text`, and `source` naming where it is written —
"brief: Seams", "commit 1a2b3c", "PR body" — or `"conversation"` when it is
written nowhere. Give each decision `files`: the paths that carry it, from the
diff. Unrecorded decisions are the most useful thing on the page;
they're what nobody can recover after a gap. Fill `beat` and `why` only from a
source, and when they come from a different place than `text`, name every
place in `source` ("PR body; CLAUDE.md, removed"). If nothing records what a
decision beat, leave `beat` out.

A decision is a choice someone made that shaped the work. An instruction about
what to do next, such as merge order or a tag to push, is an action: it goes in
`open` while it's still pending and nowhere once it's done or moot. Settled
items go in decisions; pending ones in `open`, drawn from the brief's open
questions and the PR summary's action lines. Never both.

**Writing.** `title` is the brief's goal in one line; without a brief, the PR
title, or else the first commit's subject. `summary` is one sentence a reader
needs before any block. `example` is one concrete case before any abstraction:
a person, what they do, and what they see, built from the brief's first user
story. Without a story, leave it out. Labels are a few words; prose stands alone,
with no "as discussed" or "this revision". Use the codebase's own terms.

## 3. Screenshots

For a `compare` block, capture the changed screen on the branch and on `main`
with the project's Playwright setup, save them as PNGs under `tmp/`, and point
`src` at them relative to the data file. If the app can't be run, leave the
block out and say so in `sources.missing`.

## 4. Build and hand over

Run the build. It lists every problem it finds; fix the data and rerun until it
writes the HTML. Then open the file (`open` on macOS, `xdg-open` on Linux) and
reply with its path and one line on anything the page flagged: a missing
source, or an unrecorded decision worth writing down.
