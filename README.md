# Skill Registry

A self-hosted registry for Agent Skills. See [`.scratch/skill-registry/spec.md`](.scratch/skill-registry/spec.md) for the full spec.

## Running it

```bash
cp .env.example .env
# set BETTER_AUTH_SECRET and PUBLIC_URL in .env
docker compose up
```

The app waits for Postgres to be ready, runs migrations, and serves the API and the
built web interface from the same origin at `http://localhost:3000`.

## Configuration

See [`.env.example`](.env.example) for the full list of environment variables. The app
refuses to start if `BETTER_AUTH_SECRET`, `PUBLIC_URL`, or `DATABASE_URL` is missing.

### Logging in through Google Workspace or Microsoft Entra

Set `PUBLIC_URL` to the address the Registry is reached at, then add an Identity
Provider under **Settings → Login** as an admin. Register the redirect URI in the
provider's console as `<PUBLIC_URL>/api/auth/callback` — one per console, whatever the
Provider's slug.

A Provider cannot be enabled without a permitted Workspace domain or Entra tenant,
because anyone it matches who signs in gets a reader account on their first login.
Password login stays available whether or not a Provider is configured: it is the way
back in if a client secret expires. See [ADR-0015](docs/adr/0015-identity-providers-keyed-by-email.md).

## Development

This is a Bun workspace: `apps/api` (Hono + Drizzle + Postgres), `apps/web`
(Vite + React + Tailwind + shadcn/ui), `apps/cli` (the `skillreg` command), and
`packages/shared` (the rules and schemas all three are built against).

```bash
bun install
bun run typecheck
bun run test   # apps/api; spins up Postgres via testcontainers, needs Docker
bun --filter @skill-registry/web dev
bun --filter @skill-registry/api dev
```
