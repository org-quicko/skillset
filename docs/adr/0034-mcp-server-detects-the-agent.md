# The MCP Server Detects the Agent Rather Than Being Told It

`add_skills` installs a Skill into the directory the User's coding Agent actually reads from. Which
Agent that is used to be a required `--agent` flag, checked at startup — a placeholder from
ADR-0033's "Agent detection is future work". It is now **detected**: `--agent` is an optional
override that stays out of the ordinary setup snippet, and with it omitted the server works out the
Agent from its surroundings (`.scratch/mcp-server/spec.md`, "Detecting the Agent"). The setup story
for the non-technical User this feature exists for is now naming the Registry and nothing else.

The detector lives in `@skillset/shared` (`src/agents/detect.ts`) and is driven by the existing
Agent table — extended with an `envMarkers` field — not a second table. `@skillset/cli`'s
`skillset add` uses the same function for its non-interactive path, so the CLI and the MCP server
cannot drift into disagreeing about what "detect the Agent" means.

## The ladder

`detectAgent(signals)` walks these in order, first hit wins:

1. **`--agent` override.** Validated against the table; an unknown value still refuses, listing the
   valid ids. The escape hatch for a wrong or missing detection.
2. **Client identity.** The MCP client's `clientInfo.name` from the `initialize` handshake
   (`server.getClientVersion()`), matched case-insensitively against every Agent's id and display
   name. The protocol-native signal.
3. **Environment markers.** Each Agent table row may carry `envMarkers` — environment variables
   whose presence marks that Agent as the one running. First row with a set marker wins.
4. **A single unambiguous project directory.** Exactly one non-universal Agent's own directory
   (`.claude/skills`, `.windsurf/skills`, …) present in the project resolves to that Agent; zero or
   two-plus does not.
5. **Canonical fallback.** No Agent. The install writes `.agents/skills/<name>` and links nothing —
   correct for the ten universal Agents, and a working (unlinked) install for the rest. It **never
   refuses**.

Every install result reports the Agent that was detected, the rung that answered, and the path
written — the mitigation for the one real risk, that a wrong detection writes somewhere the User
never chose and, unlike a wrong flag, is nobody's visible mistake.

## Considered options

**Keep `--agent` required.** Rejected: it is the friction the spec's whole "Detecting the Agent"
section exists to remove, and it blocks the non-technical User entirely — the person who pastes a
JSON block and never opens the flag reference. The startup crash the User hit
(`An Agent is required for now`) is this option's failure mode.

**Depend on `@vercel/detect-agent`.** Its `agents.json` is the best public catalogue of Agent
environment markers and we cross-check every marker against it. But taking it as a dependency cuts
against ADR-0033's reason for a separate `@skillset/mcp` workspace (keep the dependency set to the
MCP SDK, `zod`, and `@skillset/shared`) and against ADR-0031's stance on the Agent table itself —
not vendored, each row verified against its Agent's own documentation rather than diffed against
someone else's release. Its ids (`claude_code`, `gemini_cli`) also do not match ours
(`claude-code`, `gemini-cli`), so a mapping layer would be needed regardless. We curate our own
`envMarkers` on the rows and cross-check against its `agents.json`.

**A second detection table, separate from the path table.** Rejected on the user's direction and on
merit: the markers belong next to the directory they resolve to, and one table is one place to keep
verified.

**Resolve detection once at startup.** Rejected: the client's identity is only known after the
`initialize` handshake, and `createServer` returns before `connect`. Detection is resolved lazily on
the first `add_skills` call — the one tool that needs an Agent — and cached.

## Consequences

**`McpConfig.agentId` is `AgentId | undefined`** — the override, not the resolved Agent.
`parseConfig` no longer throws when `--agent` is absent; it still rejects a value naming no row.

**The installer accepts `agentId: null`.** `resolveInstallTarget` and `installSkill` widen their
`agentId` parameter, and `WriteReport.agent` widens to `AgentId | null`. A `null` Agent resolves the
Agent directory to the canonical directory, so the existing "reads `.agents/skills` directly" branch
produces the link-nothing install with no new code path. `skillset add` with an explicit `--agent`
is unaffected.

**`add_skills` returns `{ detection, outcomes }`.** The batch result carries the governing detection
alongside the per-Skill outcomes, so the caller can report which Agent was chosen and how.

**`skillset add` no longer requires `--agent` outside a terminal.** With no flag and no TTY it
detects instead of erroring; `--scope` is still required there (a Scope cannot be detected). The
interactive prompt is unchanged.

**Two markers are deferred.** `devin` (a `/opt/.devin` file probe) and `kiro-cli` (a `TERM_PROGRAM`
value match plus a no-TTY check) need I/O or logic beyond "is this environment variable set", which
`envMarkers` deliberately does not model. Both fall through to the project-directory rung or the
canonical fallback until added.

**Per-request `_meta` client identity is not used.** The 2026-07-28 MCP revision carries identity on
every request; `getClientVersion()` from the handshake is simpler and sufficient, and layering the
per-request signal in later does not change the `detectAgent` seam.
