# `install` Merges an Existing `.mcp.json`

`skillset install` for an MCP Server writes a single entry into the **project's `.mcp.json`**, merging
into whatever is already there, and names no Agent. Where it cannot — `--scope user`, or a
refused write — it prints the JSON snippet to paste instead. The 76-entry Agent → directory table
plays no part: it maps an Agent to a *skills* directory, and there is nothing to map an MCP Server
onto.

> **Amends ADR-0022 and ADR-0006.** The vendored Agent table, the canonical `.agents/skills`
> install, and the symlink-with-copy-fallback are unchanged — they are now explicitly
> **Skill-only**. ADR-0006's "offer only agents whose paths we have verified" is restored as the
> governing principle for MCP config locations, because ADR-0022's reason for overriding it
> (upstream maintains the table, so vendor it wholesale) has no equivalent here.

## Considered Options

**A second Agent → MCP-config-path table.** This is what symmetry with Skills suggests, and it is
the option to reject most firmly. There is no upstream table to vendor: `vercel-labs/skills` maps
Agents to skills directories and nothing else. Building one would mean 76 rows we hand-verify and
then own forever, for a field where only some Agents support MCP at all and the locations diverge
(`.mcp.json`, `~/.claude.json`, `.cursor/mcp.json`, `.vscode/mcp.json`). ADR-0006 was written
about exactly this failure — "an unverified path is worse than an absent one, because it writes to
a real directory that nothing reads" — and ADR-0022 only overrode it because someone else was
maintaining the data.

**Refusing MCP Servers entirely and only ever printing the snippet.** Honest, and kept as the
fallback rather than the whole answer. Rejected as the default because "we hold this Resource but
cannot install it" makes the CLI a worse client than a copy button in the browser.

**Prompting for a config path.** Rejected: it asks the User for a fact the tool should know, and
a wrong answer writes valid JSON somewhere nothing reads — ADR-0006's failure mode with an extra
prompt in front of it.

## Consequences

**This is the first time `install` writes into a file the developer already owns.** Every existing
install path creates a fresh directory (`.agents/skills/<name>`) or a symlink beside it; nothing
has ever had to merge. A repository's `.mcp.json` holds other people's servers, and corrupting it
breaks their setup, not just this install. That needs care the Skill path never needed:

- Read, parse, insert one key under `mcpServers`, write back. Never rewrite the file wholesale
  from a template.
- A file that exists but does not parse is a **refusal**, not something to overwrite. Print the
  snippet and say why.
- An entry already present under this Resource's name is replaced only on explicit confirmation
  (or `--force`); otherwise it is left alone and reported.
- Formatting and key order outside `mcpServers` should survive the round trip as far as is
  practical, because a diff nobody asked for is how a tool loses trust in a shared repository.

ADR-0001's parting observation — that `skillset install` is where a hostile Artifact is actually
stopped, because path-safety and entry-cap validation happen at extraction — has no counterpart
for a merge. The threat is different in kind: not a hostile bundle escaping its directory, but a
malformed write destroying a file the Registry did not create. The protections above are that
threat's equivalent and should be treated as load-bearing, not defensive polish.

**`--scope user` is unsupported for an MCP Server.** A user-level MCP config is per-Agent
(`~/.claude.json` and friends), which is precisely the table this ADR refuses to invent. `install`
errors and prints the snippet, the same way ADR-0022 already errors rather than guessing for the
two Agents with no user-level directory.

Selecting an Agent is skipped entirely for an MCP Server — no prompt, no `--agent`. If one is
passed, it is ignored with a note rather than silently honoured, since honouring it would imply a
per-Agent destination that does not exist.
