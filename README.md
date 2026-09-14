# Skillset

A self-hosted registry for the things a coding agent loads: **Skills**, **MCP Servers**, and
**Plugins**. Resources are published from the CLI, the MCP server, or the web interface, stored
as rows in Postgres and — for the Kinds that have bytes (Skills, Plugins) — as files in object
storage, then discovered and installed by members of a single team. See
[`.scratch/skill-registry/spec.md`](.scratch/skill-registry/spec.md) for the full spec and
[`CONTEXT.md`](CONTEXT.md) for the domain language used throughout the codebase.

## Running it

```bash
cp .env.example .env
# set BETTER_AUTH_SECRET and PUBLIC_URL in .env
docker compose up
```

The app waits for Postgres to be ready, runs migrations, and serves the API and the
built web interface from the same origin at `http://localhost:3000`.

`docker-compose.yml` is local-dev only: it bundles Postgres and MinIO with well-known
default credentials. For production, use `docker-compose.prod.yml`, which runs only the
`app` image against your own managed Postgres and S3 (or S3-compatible) service:

```bash
cp .env.example .env
# fill in .env for production: real DATABASE_URL, a generated BETTER_AUTH_SECRET,
# your public PUBLIC_URL, and your managed STORAGE_* values
docker compose -f docker-compose.prod.yml up -d --build
```

## Configuration

The full, authoritative list of environment variables lives in
[`.env.example`](.env.example) with inline comments explaining each one — read that file before
deploying. The app refuses to start if `BETTER_AUTH_SECRET`, `PUBLIC_URL`, `DATABASE_URL`, or
`STORAGE_BUCKET` is missing. Summary:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | — | Postgres connection string the app connects with. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Local dev only | `postgres` / `postgres` / `skill_registry` | Credentials the bundled Postgres container is created with; must stay in sync with `DATABASE_URL`. Required in production if you use the bundled container. |
| `BETTER_AUTH_SECRET` | Yes | — | Session signing secret. Generate with `openssl rand -base64 32`. |
| `PORT` | No | `3000` | Port the application listens on. |
| `PUBLIC_URL` | Yes | — | Absolute base URL the Registry is reached at, no trailing slash. Every session cookie and OAuth `redirect_uri` is built from it (ADR-0016). |
| `ANALYTICS_REFRESH_CRON` | No | `*/30 * * * * *` | node-cron expression (seconds field first) controlling how often install counts refresh. |
| `STORAGE_BUCKET` | Yes | — | S3 (or S3-compatible) bucket; publishing presigns uploads against it. |
| `STORAGE_REGION` | No | `us-east-1` | Bucket region. |
| `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | No | — | Leave unset in production to fall back to AWS's default credential chain (e.g. an instance/task role) instead of a long-lived key. |
| `LOG_LEVEL` | No | `info` | Application log verbosity. |

### Logging in through Google Workspace or Microsoft Entra

Set `PUBLIC_URL` to the address the Registry is reached at, then add an Identity
Provider under **Settings → Login** as an admin. Register the redirect URI in the
provider's console as `<PUBLIC_URL>/api/auth/callback/<kind>`, where `<kind>` is `google`,
`microsoft`, or `github` — one per console.

A Provider cannot be enabled without a permitted Workspace domain or Entra tenant,
because anyone it matches who signs in gets a reader account on their first login.
Password login stays available whether or not a Provider is configured: it is the way
back in if a client secret expires. See [ADR-0015](docs/adr/0015-identity-providers-keyed-by-email.md).

## Using the Registry

Once running, a team can interact with it three ways:

- **Web interface** — browse, search, and manage Resources at `PUBLIC_URL`.
- **CLI** (`apps/cli`, published as [`@in-org-quicko/skillset-cli`](apps/cli/README.md)) — publish
  and install Skills from the command line:
  ```bash
  npm install -g @in-org-quicko/skillset-cli
  skillset login --registry <url>
  skillset publish [path]
  skillset add <name>
  ```
- **MCP server** (`apps/mcp`, published as [`@in-org-quicko/skillset-mcp`](apps/mcp/README.md)) —
  lets a coding agent search, install, and publish Skills itself over stdio:
  ```bash
  npx @in-org-quicko/skillset-mcp --registry <url>
  ```

Both clients read `SKILLSET_REGISTRY` and `SKILLSET_TOKEN` environment variables, which always
override stored/CLI-flag config — useful for CI.

## Development

This is a Bun workspace: `apps/api` (Hono + Drizzle + Postgres), `apps/web`
(Vite + React + Tailwind + shadcn/ui), `apps/cli` (the `skillset` command), `apps/mcp` (the MCP
server), and `packages/shared` + `packages/installer` (the rules, schemas, and install logic the
others are built against).

```bash
bun install
bun run typecheck
bun run test   # apps/api; spins up Postgres via testcontainers, needs Docker
bun --filter @in-org-quicko/skillset-web dev
bun --filter @in-org-quicko/skillset-api dev
```
