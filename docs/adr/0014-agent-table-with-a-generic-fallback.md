# The Agent Table Gets a Generic Fallback

`skillreg add` implements ADR-0006's full five verified Agents (`claude-code`, `codex`,
`github-copilot`, `opencode`, `pi`) plus one addition of our own: `generic`, for the
`.agents/skills` convention a large share of *other* tools already default to — per
`vercel-labs/skills`'s own ~90-entry table, dozens of Agents point there. `generic` isn't
one of ADR-0006's five; it plays a second role beyond being an installable target:
`resolveInstallDir("generic", scope, ctx)` **is** the canonical directory a Skill is
written to once, before any other selected Agent gets symlinked to it
(`apps/cli/src/install.ts`).

## Consequences

At "project" Scope, `codex`, `github-copilot`, `opencode`, and `generic` all resolve to
the identical path (`.agents/skills`) — selecting any of them there is a no-op past the
canonical write, matching what `vercel-labs/skills` calls a "universal agent"
short-circuit. `claude-code` and `pi` never coincide with canonical at either Scope, so
they always get a real symlink (a junction on Windows).
