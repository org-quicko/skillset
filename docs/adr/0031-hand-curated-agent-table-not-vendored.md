# The Agent Table Is Hand-Curated, Not Vendored

> **Amends ADR-0022** and restores ADR-0006's "verify what we offer" principle. `add`'s
> canonical-directory-plus-symlink install model (ADR-0022) is unaffected — only the *source*
> of the Agent table changes.

`packages/shared/src/agents/table.ts` is no longer the ~76-entry `vercel-labs/skills` table
vendored wholesale under its MIT license. It is a hand-curated list of Agents in wide, current
use, each row verified against that Agent's own public documentation rather than copied from
someone else's compiled file.

## Considered Options

**Keep vendoring the full upstream table.** Rejected. It commits this Registry to two ongoing
obligations for the life of the file: carrying a third-party MIT notice
(`LICENSE.vercel-labs-skills`) in `packages/shared`, and re-syncing by diff against upstream
releases indefinitely — for a list where the large majority of rows are Agents this Registry's
Users are never going to choose from a searchable prompt. Neither obligation buys anything a
smaller, owned table doesn't.

**Rewrite the full ~76-entry table independently, keeping every row.** Rejected as effort with
no payoff: verifying seventy-plus long-tail Agents' directory conventions against their own
docs, and keeping all seventy-plus current as those tools evolve, costs the same ongoing
maintenance as vendoring did — it only trades away the license file, not the tracking burden.

**Return to ADR-0006's exact five-Agent table.** Rejected as too narrow for today's Agent
landscape: ADR-0006 predates most of the Agents Users now actually reach for (`cursor`,
`windsurf`, `cline`, among others), and a table that omits them defeats the point of `add`
offering a searchable choice.

## Consequences

`AGENTS` now lists Agents in current, wide use — `claude-code`, `codex`, `cursor`, `windsurf`,
`cline`, `github-copilot`, `gemini-cli`, and others verified the same way — rather than every
Agent a third-party project has ever added a row for. `LICENSE.vercel-labs-skills` is deleted;
no vendored third-party code remains under `packages/shared/src/agents`. Growing the table means
verifying a new Agent's own directory convention from its own documentation and adding one row,
not diffing against an upstream commit.

Two behaviours the old vendored table happened to exercise have no current row to demonstrate
them, and the tests that relied on those specific rows are gone rather than kept alive with data
that no longer reflects a real, offered Agent:

- **An Agent with no user-level directory** (`userSkillsDir` returning `null`, and `add --scope
  user` refusing rather than guessing). The type signature and `installSkill`'s refusal are
  unchanged and still correct if a future row needs this; there is simply no currently-curated
  Agent that does.
- **An Agent whose project- and user-Scope directories use different suffixes** (the old table's
  `pi`: `.pi/skills` for project, `.pi/agent/skills` for user). Every currently-curated Agent
  uses the same suffix at both Scopes; `agentSkillsDir` still resolves each Scope independently
  and would handle a future row that differs.

`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GROK_HOME`, and `XDG_CONFIG_HOME` remain load-bearing
overrides for the Agents that read them. Maintaining a smaller, hand-verified set of
third-party conventions is ongoing work taken on deliberately, same as ADR-0006's original
five — just a wider five-becomes-many for the Agents Users actually reach for today.
