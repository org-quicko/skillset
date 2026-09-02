# Integration table and Admin configuration

## What to build

The `integrations` table, and the Admin-only routes that populate it. An **Integration** is the
Registry's registration with one Git Provider, holding the credential pair a Connection is granted
against. Importing from a Git Provider is available for exactly those providers that have a row —
this is the only switch, and ADR-0024 explains why there is no Admin-level import toggle above it.

Nothing imports yet. This ticket makes the credential configurable and nothing more.

```
integrations
  provider        text primary key          -- "github"; matches the shared provider config key
  display_name    text not null
  client_id       text not null
  client_secret   text not null             -- stored as given, per ADR-0015
  app_slug        text                      -- nullable: only GitHub has an install URL
  created_at / updated_at
```

Follow `identity-providers.ts` for the route and service shape — same pattern, same role gating,
same read-per-request so an edit takes effect without a restart (ADR-0019).

## Acceptance criteria

- [x] Migration creates `integrations` with `provider` as the primary key, and the schema file says
      what `app_slug` is for and why it is nullable. Code comments, not `COMMENT ON COLUMN` — this
      repo has never used Postgres comments, and `docs/data-model.md` is where a column is explained
      at length.
- [x] `GET /integrations` is Admin-only and lists configured Integrations.
- [x] `POST /integrations` creates one; a second row for the same `provider` is refused.
- [x] `PATCH /integrations/:provider` updates it, including `client_secret`.
- [x] `client_secret` is write-only: it appears in no response shape, on any route, ever. Assert this
      directly rather than by reading the code.
- [x] `provider` is rejected unless it is a key of the shared provider config table — the database
      constrains Connections, and this constrains registrations.
- [x] A reader and a writer are both refused on every one of these routes.
- [x] Credentials are read per request, so an edit is picked up on the next use with no restart.
- [x] `docs/data-model.md` and `docs/openapi.json` are updated to match.
- [x] No change to `identity_providers`. The sign-in OAuth App's credentials stay where they are —
      ADR-0024 records why consolidating the two tables was rejected.

## Blocked by

Nothing.

---
GitHub: #32
Spec: `.scratch/github-import/spec.md`
ADR: `docs/adr/0024-import-is-a-github-app-and-login-stays-an-oauth-app.md`
Data model: `docs/data-model.md` · API: `docs/openapi.json`
