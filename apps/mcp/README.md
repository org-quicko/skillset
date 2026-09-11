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
    "skillset": {
      "command": "npx",
      "args": ["-y", "@in-org-quicko/skillset-mcp", "--registry", "<url>"]
    }
  }
}
```

### Options

| Flag / env var | Default | Description |
| --- | --- | --- |
| `--registry <url>` / `SKILLSET_REGISTRY` | *(required)* | The Registry to talk to |
| `--token <secret>` / `SKILLSET_TOKEN` | *(none)* | Required only for `publish_skill`; reads need no credential |
| `--scope <project\|user>` | `project` | Where `add_skills` installs to |
| `--agent <id>` | *(auto-detected)* | Overrides Agent detection |
| `--log-level <debug\|info\|warn\|error>` | `warn` | Diagnostics verbosity (stderr only) |

### Tools

- `search_skills` — search the Registry for Skills
- `add_skills` — download and install one or more Skills for the detected (or given) Agent
- `publish_skill` — publish a Skill to the Registry (requires a Token)

## License

AGPL-3.0-only
