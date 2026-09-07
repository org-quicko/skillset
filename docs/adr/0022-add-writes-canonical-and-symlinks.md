# `add` Writes One Canonical Copy And Symlinks The Agent To It

> **Amended by ADR-0029.** All of this is Skill-only. `add` for an MCP Server merges a
> project's `.mcp.json`, names no Agent, and never touches `.agents/skills`.

> **Amended by ADR-0031.** The Agent table is no longer vendored wholesale from
> `vercel-labs/skills` — it is hand-curated and independently verified. Everything below about
> *how* an install lands (the canonical directory, the symlink, the fallback to a copy) is
> unaffected; only the table's source and size changed.

`skillreg add` writes every Skill's files to the canonical `.agents/skills/<name>` directory,
and for an Agent that reads somewhere else — `claude-code` at `.claude/skills`, `pi` at
`.pi/skills` — it creates a symlink there pointing back at the canonical copy. The Agent list
is the full ~76-entry table vendored from `vercel-labs/skills`, and the choice is made through
a searchable prompt.

This reverses **ADR-0014**, which withdrew exactly this design, and amends **ADR-0006**, which
scoped the table to five hand-verified Agents.

> **Supersedes ADR-0014** entirely and **amends ADR-0006**. ADR-0014's objection still reads
> true — installing for `claude-code` now also creates `.agents/skills/<name>`, a directory
> other Agents read and the User did not name — and it was overridden deliberately: matching
> `vercel-labs/skills`' behaviour, so a Skill added once is visible to every Agent that follows
> the `.agents/skills` convention, was judged worth that cost. ADR-0006's "only verify what we
> can" principle is relaxed to "vendor the upstream table wholesale and re-sync by diff";
> `generic` (ADR-0014's own addition) is dropped, since the canonical directory now plays its
> role for real.

## Considered Options

**Keeping ADR-0014's one-directory install.** Still the design that never writes to a directory
the User did not choose. Rejected because it makes "install this Skill for my machine" an
N-Agents-N-commands chore, and because the canonical `.agents/skills` directory is a published
convention dozens of Agents already read — writing there is not a surprise, it is the point.

**Keeping the five-Agent table (ADR-0006).** Verifying each row is real work, and an unverified
row writes to a directory nothing reads. Rejected because the upstream table is now large,
actively maintained, and the single source others already trust; tracking a five-row subset of
it is more error-prone than vendoring the whole thing and re-syncing by diff against a recorded
commit. The header comment in `packages/shared/src/agents/table.ts` records the commit
(`435076e…`, v1.5.23) for exactly that.

**`detectInstalled` to narrow the prompt.** Upstream probes the filesystem (`~/.claude`,
`~/.codex`, …) and offers only Agents it finds. Rejected as scope: it pulls `node:fs` into a
module shared with the browser, and a searchable autocomplete over ~76 names is fast enough to
not need it. `--agent <id>` still accepts any id directly.

**Symlink-only, erroring on failure.** Simpler, but breaks on Windows without Developer Mode and
on filesystems with no symlink support. Rejected: a refused symlink falls back to a real copy,
and `--copy` forces a copy up front. Windows gets a junction.

## Consequences

Installing for **any** Agent creates `.agents/skills/<name>` — that is where the files live.
`claude-code`, `pi`, and every other Agent with its own directory additionally get a symlink
(or, on failure or `--copy`, a copy) at `<their-dir>/<name>`. A "universal" Agent — one whose
directory *is* `.agents/skills` — gets nothing extra; the report says it "reads .agents/skills
directly".

`eve` and `promptscript` have no user-level directory. `add --scope user` for one of them errors
rather than guessing.

The Skill's own name (`SKILL.md` frontmatter, Registry-reported) is sanitised before it becomes
a directory name, unchanged from ADR-0006. Artifact inspection (ADR-0001) is unchanged: `add` is
still the only place a hostile Artifact is stopped.

`.agents/skills` at "user" Scope is `~/.agents/skills`, matching upstream.

Re-syncing the table against a newer `vercel-labs/skills` is a diff of one data file, plus
dropping any upstream-only machinery (`detectInstalled`, Eve subagents, the `universal`
pseudo-Agent) the way this port already does.
