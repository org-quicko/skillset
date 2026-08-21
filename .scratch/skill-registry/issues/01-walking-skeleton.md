# 01 — Walking skeleton

**What to build:** An operator can bring the Registry up with a single compose command and get a running, empty Registry. Nothing is user-facing yet — this is the frame every later ticket hangs on, and the point is that the frame is verifiable rather than assumed.

**Blocked by:** None — can start immediately.

**Status:** ready-for-review

- [x] One compose command starts the application and Postgres 18, and the application waits for the database to be ready before serving.
- [x] Migrations run at startup, guarded by an advisory lock, and are idempotent across restarts.
- [x] The application refuses to start when the signing secret is missing, naming it in the failure rather than generating one.
- [x] Configuration comes from the documented environment: database location, bucket, region, storage credentials, signing secret, port.
- [x] A single process serves both the API and the built web interface from the same origin.
- [x] The web interface is a React single-page application with Tailwind CSS, shadcn/ui initialised, and a server-state provider in place; one shadcn component renders to prove the pipeline end to end.
- [x] The storage adapter contract is declared in full — put, get, exists, delete, list by prefix, presign for upload, presign for download — with a fake implementation for tests. The S3 implementation arrives in ticket 03.
- [x] The API test harness calls the application directly, with no server listening, against a real Postgres and the fake storage adapter, and at least one test passes through it.

## Comments

Implemented as a Bun workspace (`apps/api`: Hono + Drizzle + postgres.js; `apps/web`: Vite + React + Tailwind + shadcn/ui, preset `b2YPEe`). `docker compose up` verified end to end: waits for Postgres, runs migrations idempotently (confirmed via restart and via the double `runMigrations` call in the test), refuses to boot without `JWT_SECRET`, and serves `/api/health` and the built SPA from the same origin. Schema is intentionally empty — no domain tables yet — so migrations run against a zero-entry journal until ticket 02 adds one.
