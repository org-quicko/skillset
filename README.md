# Skillset

Skillset is a self-hosted registry for the resources a coding agent loads: **Skills**, **MCP
Servers**, and **Plugins**. Your team publishes them from the CLI or the web interface, and
discovers, previews, and installs them from either the web interface or an agent talking to
the bundled MCP server — all under your own infrastructure, with your own access control.

- **Skills** are directory bundles (a `SKILL.md` plus supporting files) that the Registry stores
  as an Artifact and serves for `skillset install` or direct download.
- **MCP Servers** are pointers — a `server.json`-shaped record naming an npm/PyPI/OCI/NuGet/Cargo
  package or a remote URL. The Registry stores no bytes for these.
- **Plugins** bundle several of the above (skills, commands, agents, hooks) behind a
  `.claude-plugin/plugin.json` manifest, for an agent to load together.

Reading the catalog needs no account; publishing, deleting, and administration are restricted to
Users with the right role. See [`CONTEXT.md`](CONTEXT.md) for the full domain vocabulary.

Every Resource records a **Source** — the repository URL it was imported from, or this Registry's
own domain in reverse-DNS notation (`com.quicko.skills`) when it was published straight here. It
is provenance rather than a link: nothing is ever re-read from it
([ADR-0041](docs/adr/0041-a-resource-records-where-it-came-from.md)).

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

### Fuzzy search

Search matches a term with Postgres full-text first, and falls back to trigram matching only
when that finds nothing — so `angulr` still finds `building-angular-applications`
([ADR-0040](docs/adr/0040-a-mistyped-search-falls-back-to-trigrams.md)).

That fallback needs the **`pg_trgm`** extension, which migration `0003_trigram_search.sql`
creates on startup. On most managed Postgres, `CREATE EXTENSION` requires a privileged role.
If the role in `DATABASE_URL` does not have it, the migration fails and the app will not
start — have a DBA create the extension once, against the same database:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

The migration is itself `IF NOT EXISTS`, so once that has been done it is a no-op. The
extension is installed unqualified, into `public`, and stays resolvable whatever `DB_SCHEMA`
names.

### Which Postgres schema it uses

Everything lives in the schema `DB_SCHEMA` names, defaulting to `public`. Set it when the database
is shared with other applications, a schema each, rather than dedicated to this Registry — the
schema is created on startup, and the shipped migrations name their schema through a placeholder
that is resolved when they run, so one build runs against any schema. See
[ADR-0036](docs/adr/0036-schema-placement-is-a-deployment-choice.md).

Nothing else needs configuring for it: every query and every migration is schema-qualified from
this one variable, so `DATABASE_URL` needs no `search_path`.

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
skillset search [query]      # what the team has published
skillset info <name>         # read a Skill without installing it
skillset install <name>      # install a Skill for a coding agent
skillset list                # what's installed here, and whether it's current
skillset update [names...]   # re-download whatever the Registry has moved on from
skillset remove <name>       # uninstall a Skill
skillset publish [path]      # defaults to the current directory
skillset whoami
```

`search` and `list` read alike and answer different questions: `search` asks what the team has
published, `list` asks what this project has installed.

`install` records each install in a `skillset-lock.json` at the project root (or your home
directory, for `--scope user`). That is what lets `list` tell a stale copy from one you have
edited, and what stops `install` and `update` replacing your edits without `--force`
([ADR-0038](docs/adr/0038-a-lockfile-records-what-was-installed.md)).

Every command also takes `--json`, which prints the result to stdout and any failure to stderr as
`{ "error": { … } }` with a non-zero exit code — for scripts, CI, and agents that shell out
rather than speak MCP. It never prompts, so `login` needs `--token` and a multi-Skill `publish`
needs `--yes`.

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

It exposes `search_skills` and `read_skill` for the Registry's catalog, `installed_skills`,
`update_skills` and `remove_skills` for what this project actually uses, plus `install_skills`
and `publish_skill` (which needs `--token` / `SKILLSET_TOKEN`). See
[`apps/mcp/README.md`](apps/mcp/README.md).

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
