# Subagent Install Writes the Agent's Own Directory, Claude Code Only

`skillset install` for a Subagent writes its one file to `<dir>/<name>.md`, where `dir` is
`.claude/agents` at project Scope and `$CLAUDE_CONFIG_DIR/agents` (falling back to
`~/.claude/agents`) at user Scope. Claude Code is the only Agent offered. Any other `--agent` is
refused with a message naming the one that is supported.

> **Amends ADR-0022.** The canonical directory plus symlink stays **Skill-only**, as ADR-0029
> already made it for MCP Servers.

## Considered Options

**A canonical `.agents/agents` directory with symlinks, as for Skills.** Rejected: ADR-0022's
canonical directory works because `.agents/skills` is a convention many Agents read. No such
convention exists for subagents, so a canonical copy would be a directory nothing reads, which is
ADR-0006's failure mode written to disk.

**Offering every Agent with a subagent feature.** Rejected for now. The formats differ, not just
the paths: GitHub Copilot's custom agents are `.agent.md` files, Kiro's are JSON, and each
supports a different set of frontmatter keys. Offering them means translating the file, and
ADR-0031 requires every row to be verified against that Agent's own documentation. A row is
added when someone has done both.

## Consequences

The table of Subagent destinations is separate from the Skill table in
`packages/shared/src/agents/table.ts`. It maps a different thing, and a Skill row carries no
obligation to support Subagents.

The Lockfile records a Subagent like a Skill: Resource id, `updated_at`, and a digest of the one
file. Subagents live in a `subagents` map of their own beside `skills`, not as a `kind` on each
entry: a Skill and a Subagent may share a name, and a CLI released before this reads `skills`
alone, so it never reports a Subagent as a Skill whose directory is missing. Every Lockfile
written before this keeps working unchanged (ADR-0038). `update` and `list` cover both maps;
`install`, `remove`, `search` and `info` take `--kind subagent`.

The MCP server's tools still manage Skills only and ignore the `subagents` map.

Installing over an existing `<name>.md` that the Lockfile does not record is refused unless
`--force`, because that file belongs to the developer, not to the Registry.
