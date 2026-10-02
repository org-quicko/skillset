# Own the Agent → Path Table

> **Amended by ADR-0022.** The table is no longer a five-Agent verified subset — it is the full
> `vercel-labs/skills` list, vendored wholesale and re-synced by diff. The install model also
> changed: `install` writes one canonical copy under `.agents/skills` and symlinks the chosen
> Agent's directory to it, rather than writing into exactly one Agent's directory. The reasons
> to *own* the table rather than depend on the package at runtime are unchanged.

> **Further amended by ADR-0029.** The table is Skill-only. An MCP Server names no Agent and
> is installed by merging a project's `.mcp.json` — and this ADR's "offer only paths we have
> verified" principle is precisely what refuses an invented Agent → MCP-config table.

`skillset install` writes a Skill into the directory a coding agent reads from, which means it
needs the per-agent conventions. We keep that mapping ourselves as plain data rather than
depending on `skills` at runtime, and we offer **only agents whose paths we have verified** —
an unverified path is worse than an absent one, because it writes to a real directory that
nothing reads and the Skill simply never loads.

Derived from `vercel-labs/skills` (MIT), `src/agents.ts` at commit
`dd3ca3c85581e593434546a4016fb3a7e7b7f937` (2026-08-18). Retain the copyright notice and
licence text at `packages/shared/src/agents/LICENSE.vercel-labs-skills`, and record the
upstream commit in a header comment so re-syncing is a diff rather than archaeology.

## Considered Options

Depending on the `skills` package at runtime was rejected — `install`'s flags and behaviour are
shaped around this table, and we do not want install semantics changing under us on a
transitive upgrade.

Lifting the full ~74-agent table was rejected as scope we cannot verify. Upstream's
`AgentConfig` has **no transform field**; per-agent rewriting is special-cased in
`installer.ts` and applies only to `eve`, so none of the five agents we support needs one.
The transform machinery originally planned for this table is therefore not built.

`@vercel/detect-agent` (published, Apache-2.0, from `vercel/vercel`) was considered for
agent detection and rejected: `install` prompts for the agent and the scope, so detection is
not needed at all.

## Consequences

Supported agents are `claude-code`, `codex`, `github-copilot`, `opencode`, and `pi`. Adding
another means verifying its paths, not just copying a row.

Two properties of the table are easy to get wrong and are the reason it is data:
`codex`, `github-copilot`, and `opencode` all share `.agents/skills` at project scope, so one
project install serves three agents — `install` echoes the resolved path and names them. And `pi`
is asymmetric: `.pi/skills` for project, `~/.pi/agent/skills` for global.

`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, and `XDG_CONFIG_HOME` are load-bearing overrides. Ignoring
them writes to a real directory the agent is not reading.

Maintaining ~5 third-party conventions is ongoing work we have taken on deliberately.
