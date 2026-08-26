# Skill Registry

A self-hosted registry for Agent Skills. See [`.scratch/skill-registry/spec.md`](.scratch/skill-registry/spec.md) for the full spec.

## Running it

```bash
cp .env.example .env
# set JWT_SECRET in .env
docker compose up
```

The app waits for Postgres to be ready, runs migrations, and serves the API and the
built web interface from the same origin at `http://localhost:3000`.

## Configuration

See [`.env.example`](.env.example) for the full list of environment variables. The app
refuses to start if `JWT_SECRET` or `DATABASE_URL` is missing.

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
