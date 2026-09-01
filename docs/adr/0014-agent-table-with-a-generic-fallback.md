# The Agent Table Gets a Generic Fallback

> **Superseded by ADR-0022.** `generic` is gone, and the canonical-directory + symlink install
> this ADR withdrew is now the design — `add` writes to `.agents/skills` and symlinks each
> Agent's own directory to it. The objection recorded below (an install for one Agent creating
> a directory others read) still holds; it was overridden on purpose. The table is now the full
> vendored upstream list, not five verified rows.

`skillreg add` implements ADR-0006's full five verified Agents (`claude-code`, `codex`,
`github-copilot`, `opencode`, `pi`) plus one addition of our own: `generic`, for the
`.agents/skills` convention a large share of *other* tools already default to — per
`vercel-labs/skills`'s own ~90-entry table, dozens of Agents point there. `generic` is a
sixth installable target and nothing more: a User who wants the convention directory can
name it, and a User who does not never touches it.

## Considered Options

An earlier draft of this decision gave `generic` a second role: its directory was the
**canonical** location every install was written to first, with every other selected Agent
symlinked (or, on failure, copied) to it. That was withdrawn. Installing for `claude-code`
alone also created `.agents/skills/<name>`, a directory three other Agents read and the
User never chose — the opposite of story 29's "automation never silently installs to the
wrong place". The symlink/junction/copy-fallback machinery it needed was also unasked-for
scope (ticket 09 says only "puts a Skill where a coding Agent will actually read it"), and
carried a Windows junction path and a test-only injection seam for a problem nobody had.

`add` now writes the Skill into exactly one directory: the one the chosen Agent reads.

## Consequences

At "project" Scope, `codex`, `github-copilot`, `opencode`, and `generic` all resolve to
the identical path (`.agents/skills`), so installing for any one of them serves all four.
`add` reports every Agent that reads the directory it wrote to — via
`agentsSharingInstallDir` — so a User who picked `codex` is told `github-copilot` and
`opencode` are covered too, and does not run the command again.

`claude-code` and `pi` never coincide with another Agent at either Scope, so installing for
one of them serves that one Agent, and the report says so by naming nothing else.

Installing for several Agents means running `add` once per Agent. That is a real cost, and
it is the price of never writing to a directory the User did not name.
