# Issue tracker: GitHub

Implementation tickets for this repo live as **GitHub issues** on `org-quicko/skill-registry`.
Use the `gh` CLI.

Specs stay in the repo as markdown — a spec is a long-form document that belongs in version
control next to the code it describes, not in an issue body. Tickets reference their spec by path.

## Conventions

- **Ticket** → one GitHub issue. Title is a short descriptive name with no number; GitHub owns the
  numbering.
- **Body** → `## What to build`, `## Acceptance criteria` (a checklist), `## Blocked by`, and a
  footer pointing at the spec, data model, API contract, and ADRs.
- **Triage state** → a real GitHub label. See `triage-labels.md`.
- **Blocking** → GitHub Issues has no native blocked-by field, so `## Blocked by` lists the
  blocking issues as `- #N — Title`. Create tickets in dependency order so those references
  resolve.
- **Comments and conversation** → issue comments.
- **Spec** → `.scratch/<feature-slug>/spec.md` in the repo.

## When a skill says "publish to the issue tracker"

Create issues with `gh issue create`, in dependency order so each ticket's `## Blocked by` can
reference real numbers. Apply the triage label at creation. Do not close or modify a parent issue.

## When a skill says "fetch the relevant ticket"

`gh issue view <number>`. The user will normally pass the number or the URL directly.

## Working the frontier

A ticket is on the frontier when every issue listed under its `## Blocked by` is closed. To find
it: list open issues carrying the AFK-ready label, and take the lowest-numbered one whose blockers
are all closed.

Claiming a ticket means assigning yourself. Finishing one means ticking its acceptance criteria,
adding a comment describing what was built, and moving its label to the review-ready state — not
closing it. Closing is the reviewer's call.

## Wayfinding operations

Used by `/wayfinder`. These stay **local markdown**, deliberately: a map and its questions are an
ephemeral planning artifact for one effort, not a backlog other people work from.

- **Map**: `.scratch/<effort>/map.md` — the Notes / Decisions-so-far / Fog body.
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question
  in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`);
  a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it
  lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and
  unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append
  a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.
