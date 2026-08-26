# A Three-Agent Table, With a Generic Fallback

ADR-0006 scoped the Agent table to five verified Agents. `skillreg add`'s first pass
implements three: `claude-code`, `codex`, and a new `generic` entry for the
`.agents/skills` convention a large share of other tools already default to — per
`vercel-labs/skills`'s own ~90-entry table, dozens of Agents point there. `generic` isn't
one of ADR-0006's five; it's this table's own addition, and it plays a second role beyond
being an installable target: `resolveInstallDir("generic", scope, ctx)` **is** the
canonical directory a Skill is written to once, before any other selected Agent gets
symlinked to it (`apps/cli/src/install.ts`). `github-copilot`, `opencode`, and `pi` stay
deferred — added later as ordinary table rows, following the same pattern.

## Consequences

At "project" Scope, `codex` and `generic` resolve to the identical path (`.agents/skills`)
— selecting `codex` there is a no-op past the canonical write, matching what
`vercel-labs/skills` calls a "universal agent" short-circuit. `claude-code` never
coincides with canonical at either Scope, so it always gets a real symlink (a junction on
Windows).
