# MCPB Packaging Is an Additional, Version-Pinned Channel

`apps/mcp` can now also be packed into a single `.mcpb` file (`bun run package:mcpb`) — the
[MCPB](https://github.com/anthropics/mcpb) format a host installs by opening one file, rather than
by running a command. This is for a host that cannot use ADR-0033's `npx` distribution at all: an
extensions UI like Claude Desktop's offers a file picker, not a place to type
`npx @in-org-quicko/skillset-mcp --registry <url>`.

## Why this needs its own entry

ADR-0033 chose `npx -y @in-org-quicko/skillset-mcp@latest` specifically *because* it is fetched
fresh on every cold start — "every session runs a current version without anyone managing an
upgrade" was the stated reason for rejecting an installed-once alternative. A `.mcpb` file is that
rejected alternative: it is unpacked once, and the copy of `dist/cli.js` inside it does not change
until a person reinstalls it. That tradeoff isn't a choice being made here so much as a property of
the format — a bundle a host runs by unzipping it can't also re-fetch itself — so this is recorded
rather than re-litigated. What ADR-0033 still holds: no tool writes without a Token, reads send no
`authorization` header, and the server still runs as a local stdio process, never a remote one.

## Decision

- `manifest.json` at `apps/mcp/manifest.json` is the MCPB descriptor. Its `server.mcp_config` runs
  `node dist/cli.js --registry <user_config.registry>` — the same entry point `npx` runs today, not
  a separate build.
- Only `registry` (required) and `token` (optional, `sensitive: true`) are exposed as `user_config`.
  `--scope`, `--agent`, and `--log-level` keep their existing defaults rather than becoming settings
  in a host's install UI — nothing here changes what those flags accept; see `src/config.ts`.
- `bun run package:mcpb` builds `dist/cli.js` and packs it with `manifest.json` via
  `@anthropic-ai/mcpb pack`, a devDependency used only at packaging time — it ships in no bundle and
  changes nothing about `npx`'s own dependency set (`--registry`/`--scope`/`--log-level` are still
  hand-parsed; see ADR-0033's "Consequences").
- `node_modules` is excluded from the bundle by `.mcpbignore`. `dist/cli.js` already has every
  dependency inlined by `src/build.ts` (`Bun.build`, ESM, target `node`) — the same file `npx`
  installs and runs — so nothing at runtime resolves through `node_modules`, and packing it would
  only have added ~200MB of unused files.

## Consequences

**A Token entered through a host's install UI is stored by that host**, not by this server — for
Claude Desktop, its OS keychain. This is a new place a `publish_skill` Token can live, beyond the
`--token`/`SKILLSET_TOKEN` ADR-0035 already covers; `manifest.json` marks the field `sensitive` so a
host that honors that hint doesn't put it in plain config. The server itself still only reads
`config.token` off `argv`/`env` exactly as before — it has no idea whether the value came from a
shell, a `.mcp.json`, or an extension UI.

**Reinstalling is the only way to upgrade.** `README.md` says so; there is no in-bundle update
check, and adding one would need this server to phone home, which nothing else here does.

**No CI wiring yet.** `bun run package:mcpb` is a local/manual step; publishing the `.mcpb` as a
release artifact (e.g. a GitHub Release asset alongside the existing npm publish in
`.github/workflows/npm-publish.yml`) is future work, not built speculatively ahead of a host that
needs it.

**`manifest.json`'s `name`/`display_name` contain no `skillset` substring at all.** The first
install against Claude Code / Cowork refused to start the server: "Its name collides with a reserved
internal server name". Renaming to `skillset-registry` / "Skillset Registry" — qualifying the word
rather than dropping it — collided the same way, so the match is not on the bare word but on the
substring `skillset` anywhere in the name. Settled on `skill-registry` / "Skill Registry" instead:
still this project's own name (not company-specific — this is open-source software, not a
Quicko-only tool), just built from a different word. `README.md`'s manual `.mcp.json` example key
was changed the same way, since a hand-configured server hits the identical collision.

**A host with required `user_config` (Claude Desktop, at least) installs the extension disabled and
leaves it that way until every `required: true` field is filled in** — its own logs say so plainly
("has missing required configuration, not enabling automatically"). A disabled extension's tools are
never offered to the model, so no amount of tool-description writing or explicit chat phrasing gets
one called; this looked identical to a "model won't use the tool" problem until the logs said
otherwise. Because the host keys the extension's identity off `manifest.json`'s `name`, each of the
renames above also reset this — a Registry URL entered before a rename does not carry over after
one.
