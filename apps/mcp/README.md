# @in-org-quicko/skillset-mcp

MCP server for searching, installing, and publishing Skills on a [Skillset](https://github.com/org-quicko/skillset) Registry, over stdio.

## Usage

Run directly with `npx` — no install step needed:

```sh
npx @in-org-quicko/skillset-mcp --registry <url>
```

Or configure it in an MCP client's config, e.g.:

```json
{
  "mcpServers": {
    "skill-registry": {
      "command": "npx",
      "args": ["-y", "@in-org-quicko/skillset-mcp", "--registry", "<url>"]
    }
  }
}
```

The server key is yours to pick, but avoid any name containing `skillset` — some hosts (observed on
Claude Code / Cowork) reserve it internally and refuse to start a server registered under it, with
"Its name collides with a reserved internal server name". Not just the bare word: `skillset-registry`
collided too. `manifest.json`'s `name`/`display_name` were renamed to `skill-registry` / "Skill
Registry" for the same reason — no `skillset` substring at all.

### Installing as an MCPB extension

For a host that only accepts a bundle (e.g. Claude Desktop's Extensions UI) rather than running an
arbitrary command, build and install `skillset-mcp.mcpb` instead:

```sh
bun run package:mcpb
```

This packs `manifest.json` and the built `dist/cli.js` — the whole server, with every dependency
already inlined by the build — into one `.mcpb` file with no `node_modules` inside it. Open the
resulting file with the host's extension installer, which will prompt for the two settings
`manifest.json` declares: the Registry URL, and, optionally, a writer Token for `publish_skill`.

Unlike `npx`, an installed bundle does **not** update itself — reinstall it to pick up a new
version (see `docs/adr/0037-mcpb-packaging-is-an-additional-pinned-channel.md`).

**The extension won't do anything until you fill in the Registry URL.** A host that requires
configuration (Claude Desktop, at least) installs the extension but leaves it disabled until its
required settings are filled in — check its logs for "has missing required configuration, not
enabling automatically" if the model never seems to see the tools at all. Open the extension's own
settings (not the chat) and set the Registry URL there; a disabled extension isn't offered to the
model, so no phrasing in a chat message will make it get called. This also means changing
`manifest.json`'s `name` (as ADR-0037's Consequences describes doing twice, chasing a naming
collision) creates a new extension identity to that host and loses whatever was configured under
the old name — expect to redo this after a rename.

### Options

| Flag / env var | Default | Description |
| --- | --- | --- |
| `--registry <url>` / `SKILLSET_REGISTRY` | *(required)* | The Registry to talk to |
| `--token <secret>` / `SKILLSET_TOKEN` | *(none)* | Required only for `publish_skill`; reads need no credential |
| `--scope <project\|user>` | `project` | Where `install_skills` installs to |
| `--agent <id>` | *(auto-detected)* | Overrides Agent detection |
| `--log-level <debug\|info\|warn\|error>` | `warn` | Diagnostics verbosity (stderr only) |

### Tools

Two sets, because the Registry's catalog and this project's installed copies are different
things and an Agent needs to tell them apart.

The Registry:

- `search_skills` — search the catalog, or list all of it when given no query. Each result
  carries `allowed_tools`, so what a Skill claims the right to reach is visible before the
  install that grants it — not only on the `read_skill` a caller may skip
- `read_skill` — read one Skill's `SKILL.md` and file list **without installing it**. Both it and
  `search_skills` report `source`: the repository URL a Skill was imported from, or the
  Registry's own domain in reverse-DNS notation when it was published straight to it
- `install_skills` — download and install one or more Skills for the detected (or given) Agent.
  A Skill already installed comes back `refused` with an `installed` field — `current`,
  `outdated`, `modified`, or `untracked` — saying what overwriting it would cost
- `publish_skill` — publish a Skill to the Registry (requires a Token)

This project:

- `installed_skills` — what is installed here, each as `current`, `outdated`, `modified`, or `missing`
- `update_skills` — re-download whatever the Registry has moved on from
- `remove_skills` — uninstall Skills from this project

`install_skills` and `update_skills` record what they wrote in a `skillset-lock.json` at the
project root (or the home directory, under `--scope user`). That is what `installed_skills`
reads to tell a stale copy from one someone has edited, and why `update_skills` refuses an
edited Skill unless asked to `force` it — see
[ADR-0038](../../docs/adr/0038-a-lockfile-records-what-was-installed.md).

### Resources

Two MCP `resources` templates expose the same catalog outside a tool call, for a host that
lists and reads resources directly:

- `skillset://skills/{name}` — one Skill's `SKILL.md` body; `name` completes against the catalog
- `skillset://tags/{tag}` — the Skills carrying one Tag; `tag` completes against the Tag catalog

`search_skills` also accepts a `cursor` (from a previous call's `next_cursor`) to page past its
own `limit`, and every tool declares an `outputSchema` matching its `structuredContent`.

## License

AGPL-3.0-only
