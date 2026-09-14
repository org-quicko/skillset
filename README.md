# Skillset

Skillset is a self-hosted registry for the resources a coding agent loads: **Skills**, **MCP
Servers**, and **Plugins**. Your team publishes them from the CLI or the web interface, and
discovers, previews, and installs them from either the web interface or an agent talking to
the bundled MCP server — all under your own infrastructure, with your own access control.

- **Skills** are directory bundles (a `SKILL.md` plus supporting files) that the Registry stores
  as an Artifact and serves for `skillset add` or direct download.
- **MCP Servers** are pointers — a `server.json`-shaped record naming an npm/PyPI/OCI/NuGet/Cargo
  package or a remote URL. The Registry stores no bytes for these.
- **Plugins** bundle several of the above (skills, commands, agents, hooks) behind a
  `.claude-plugin/plugin.json` manifest, for an agent to load together.

Reading the catalog needs no account; publishing, deleting, and administration are restricted to
Users with the right role. See [`CONTEXT.md`](CONTEXT.md) for the full domain vocabulary.

## Running it

```bash
cp .env.example .env
docker compose up
```

The app waits for Postgres to be ready, runs migrations, and serves the API and the built web
interface from the same origin at `http://localhost:3000`. After setting up, the user is first prompted to create a super admin

## Configuration

See [`.env.example`](.env.example) for the full list of environment variables (database,
storage/S3, `PUBLIC_URL`, logging, etc).

### Logging in through Google Workspace or Microsoft Entra

Set `PUBLIC_URL` to the address the Registry is reached at, then add an Identity Provider under
**Settings → Login** as an admin. Register the redirect URI in the provider's console as
`<PUBLIC_URL>/api/auth/callback` — one per console, whatever the Provider's slug.

A Provider cannot be enabled without a permitted Workspace domain or Entra tenant, because anyone
it matches who signs in gets a reader account on their first login. Password login stays available
whether or not a Provider is configured: it is the way back in if a client secret expires.

## Using it

Once a Registry is running, connect to it from either the `skillset` CLI or the MCP server —
both talk to the same Registry over its API and need only a URL (and a token for writes).

### CLI

```bash
npm install -g @in-org-quicko/skillset-cli

skillset login --registry <url>
skillset publish [path]      # defaults to the current directory
skillset add <name>          # install a Skill for a coding agent
skillset whoami
```

For CI, skip `login` and set `SKILLSET_REGISTRY` and `SKILLSET_TOKEN` instead — see
[`apps/cli/README.md`](apps/cli/README.md).

### MCP server

Run directly with `npx`, or add it to an agent's MCP client config:

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

It exposes `search_skills`, `install_skills`, and `publish_skill` (which needs `--token` /
`SKILLSET_TOKEN`). See [`apps/mcp/README.md`](apps/mcp/README.md).

## Development

This is a Bun workspace: `apps/api` (Hono + Drizzle + Postgres), `apps/web`
(Vite + React + Tailwind + shadcn/ui), `apps/cli` (the `skillset` command), `apps/mcp` (the MCP
server), and `packages/shared` (the rules and schemas all of them are built against).

```bash
bun install
bun run typecheck
bun run test   # apps/api; spins up Postgres via testcontainers, needs Docker
bun --filter @in-org-quicko/skillset-web dev
bun --filter @in-org-quicko/skillset-api dev
```
