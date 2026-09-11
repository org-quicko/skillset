# Pre-release review: issues

Scope: the whole monorepo — `apps/api` (Hono + Better Auth + Drizzle), `apps/web` (Vite + React),
`apps/cli`, `apps/mcp`, `packages/shared`, `packages/installer`, and the Docker/Compose setup.

Baseline at the time of review (branch `feature/skill-registry`, commit `22b4ccb`):

- `bun run typecheck`: clean.
- `bun run lint`: 0 errors, 7 warnings (`react-refresh/only-export-components`).
- `bun run test`: all green. API 388 tests, shared 270, installer 25, cli 58, mcp 46.
- `bun audit`: 30 advisories (9 high). See ISSUE-14.

Severity: **Critical** means exploitable now, with a large blast radius. **High** means exploitable,
or a release blocker. **Medium** should be fixed before or soon after release. **Low** is hardening
or hygiene.

Some items overlap with decisions recorded in the ADRs. Where that happens the ADR is cited, and the
item says what the ADR does not cover.

---

## Summary

| #  | Severity | Area | Title |
|----|----------|------|-------|
| 1  | Critical | API / artifacts | Stored XSS on the Registry origin through `.xml` artifact files |
| 2  | Critical | Auth | Account takeover (incl. Superadmin) through a Microsoft Entra login when the Provider is ungated |
| 3  | High | Authz | Admins can create, promote, demote and remove other Admins |
| 4  | High | Setup | The first visitor to a new instance becomes Superadmin |
| 5  | High | Storage / DoS | Presigned uploads have no size bound, and unauthenticated reads buffer whole objects in memory |
| 6  | High | Tokens | Tokens never expire, carry no scope, and can mint more tokens |
| 7  | High | Rate limiting | Login rate limiting keys on a spoofable header; nothing else is rate limited |
| 8  | Medium | HTTP | No security headers on the SPA or API (CSP, clickjacking, HSTS) |
| 9  | Medium | Secrets | IdP and Integration client secrets stored in plaintext; one key reused for HMAC and encryption |
| 10 | Medium | Sessions | Changing a password does not revoke other sessions or tokens |
| 11 | Medium | Supply chain | Any writer can silently replace any Skill that agents then load |
| 12 | Medium | MCP | `publish_skill` can publish any directory on disk |
| 13 | Medium | DB | The migration advisory lock can be taken and released on different connections |
| 14 | Medium | Dependencies | Known-vulnerable versions of hono, drizzle-orm and transitive packages |
| 15 | Medium | Performance | Non-concurrent materialized view refresh every 30 s on every replica |
| 16 | Medium | Web | Rendered markdown allows `<style>`, remote images and forms |
| 17 | Medium | CSRF | No Origin check on cookie-authenticated mutations; JSON parsed without a content-type check |
| 18 | Medium | Deploy | Container runs as root; images unpinned; Compose defaults are unsafe for anything but local dev |
| 19 | Low | Observability | Admin actions logged without the actor; no request log or request id |
| 20 | Low | HTTP | No request body size limit or handler timeout |
| 21 | Low | Ops | No graceful shutdown |
| 22 | Low | CLI / MCP | Tokens accepted over plain `http://`; MCP token passed on argv |
| 23 | Low | Analytics | Install counts can be inflated by anyone |
| 24 | Low | Concurrency | Concurrent publishes of one name interleave prune and upload |
| 25 | Low | Docs / config | README quick start fails as written; README contradicts code and `.env.example` |
| 26 | Low | Code quality | Maintainability findings (route-order coupling, validation split, naming drift, OpenAPI drift, and more) |

---

## ISSUE-1 — Stored XSS on the Registry origin through `.xml` artifact files

**Severity:** Critical · **Where:** `apps/api/src/routes/resources.ts:45`, `packages/shared/src/artifact-media.ts:68`

`GET /api/resources/:id/files/:path` serves artifact bytes **from the Registry's own origin**. The
route adds a sandboxing CSP only for `text/html` and `image/svg+xml`. A `.xml` file is served as
`application/xml; charset=utf-8` with no CSP. Browsers render XML documents, and they execute
`<script>` elements in the XHTML namespace inside them:

```xml
<html xmlns="http://www.w3.org/1999/xhtml"><script>/* runs on the Registry origin */</script></html>
```

**Exploit:** any writer publishes a Skill containing `x.xml`. Anyone who opens
`/api/resources/<id>/files/x.xml` (the web UI's "Open file" link does this for files it cannot
preview) runs the attacker's script same-origin. The session cookie is `httpOnly`, but the script
does not need to read it. Same-origin `fetch` carries the cookie, so the script can call
`POST /api/users/me/tokens` and exfiltrate a long-lived token, or act directly as an Admin
(create users, change Identity Providers, delete Skills). Reads are unauthenticated (ADR-0013), so
the link works for any visitor.

The allowlist approach is the root cause: every script-capable type (`xml`, and anything added to
`MEDIA_TYPES` later, e.g. `xhtml` or `xsl`) has to be remembered individually.

**Fix:**
1. Invert the default. Send `Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox`
   on **every** artifact file response. Exempt only `application/pdf`, or serve PDFs with
   `Content-Disposition: attachment`.
2. Serve `xml` as `text/plain; charset=utf-8`. The preview is a code viewer anyway.
3. Longer term, serve user content from a separate origin (e.g. `usercontent.<domain>`, or signed
   storage URLs). That is the only structural fix.
4. Add a test that asserts every artifact response carries the sandbox CSP, whatever its extension.

---

## ISSUE-2 — Account takeover (incl. Superadmin) through a Microsoft Entra login when the Provider is ungated

**Severity:** Critical (when a Microsoft Provider is enabled ungated) · **Where:** `apps/api/src/auth/instance.ts:125`, `:426`

When a Microsoft Provider has no permitted tenants, `tenantId` is `common`. The `tid` gate is
skipped (ADR-0021), and `microsoft` is in `accountLinking.trustedProviders`. Better Auth's Entra
provider takes `email` from the ID token's `email` claim. In Entra that claim is a **mutable,
admin-set attribute that Microsoft does not verify**. This is the published "nOAuth" class of bug.

**Exploit:** an attacker creates a free Entra tenant and sets a user's `mail` to the Superadmin's
address. They then sign in with Microsoft. Better Auth finds the existing User by email. Microsoft
is a trusted provider, so it links the account and signs the attacker in **as the Superadmin**.

An **Admin** can put the system in this state, because Identity Provider management is `admin`,
not `superadmin`. So this is also an Admin → Superadmin escalation path (see ISSUE-3).

Google is not affected in the same way: it only asserts `email_verified: true` for addresses it has
verified. Leaving GitHub out of `trustedProviders` already avoids the same problem there.

**Fix (any of these, ideally the first two):**
- Remove `microsoft` from `trustedProviders` whenever the Provider is ungated or multi-tenant. Only
  auto-link when exactly one tenant is pinned and `tid` matches.
- Never auto-link an external login to a `superadmin` (optionally also `admin`) account. Require
  the account holder to link it from Settings while signed in.
- Refuse to save an ungated Microsoft Provider, or require an explicit `superadmin`-only
  confirmation to do so.
- Make Identity Provider create/update a `superadmin` action.

---

## ISSUE-3 — Admins can create, promote, demote and remove other Admins

**Severity:** High · **Where:** `apps/api/src/services/users.ts:94`, `:211`, `:249`; `packages/shared/src/role.ts`

CONTEXT.md says an **Admin** "can create and manage readers and writers" and a **Superadmin** can
"additionally create and manage Admins". The code does not enforce that:

- `POST /users` accepts `role: "admin"` from any Admin (`AssignableRoleSchema` includes `admin`).
- `PATCH /users/:id` lets an Admin promote a writer to admin, or demote another Admin.
- `DELETE /users/:id` lets an Admin remove another Admin.

The only check is "target is not the Superadmin". One compromised or rogue Admin account can mint
more Admins and lock out the others.

**Fix:** in `UsersService`, when the actor is not `superadmin`, refuse (403) if the target's current
role is `admin` or the requested role is `admin`. Mirror this in the web UI's role picker. Add tests
for each of the three routes.

---

## ISSUE-4 — The first visitor to a new instance becomes Superadmin

**Severity:** High · **Where:** `apps/api/src/routes/setup.ts:26`

`POST /api/setup` is unauthenticated, and whoever calls it first on an empty database becomes the
permanent Superadmin. The advisory lock stops a race between two calls, but not a stranger. An
instance deployed on a public URL can be claimed in the window before its operator opens it.
Because the role "is permanent — never transferred", recovery means wiping the database.

**Fix:** require a one-time setup secret. Either read `SETUP_TOKEN` from the environment, or
generate one at boot and print it to the log when no User exists (the Grafana/Jenkins pattern), and
require it in the `POST /setup` body. Document it in the README.

---

## ISSUE-5 — Presigned uploads have no size bound, and unauthenticated reads buffer whole objects in memory

**Severity:** High · **Where:** `apps/api/src/storage/s3.ts:48`, `:82`; `apps/api/src/services/resources.ts:714`, `:761`

- The manifest's declared sizes are validated, but the presigned `PUT` does not sign a
  `Content-Length`. A writer can upload objects of any size (S3's limit is 5 GB per PUT) for the
  15-minute validity of each URL. ADR-0001 accepts drift between declared and actual size, but not
  the consequences below.
- `S3StorageAdapter.get` calls `file.arrayBuffer()` and loads the **whole object into memory**.
- `buildArtifactArchive` reads **every** file into memory before `buildArtifact` checks the size.
  `readArtifactFile` never checks it.
- Both routes are unauthenticated. A handful of parallel `GET /resources/<id>/artifact` requests
  against one oversized Skill will exhaust the API process's memory.

**Fix:**
- Sign `Content-Length` into the presigned URL (declared size), or switch to a presigned **POST**
  policy with a `content-length-range` condition.
- Before reading, use the sizes storage already reports in `list()`. Refuse (413/422) when any file
  exceeds its limit or the total exceeds `ARTIFACT_MAX_UNCOMPRESSED_BYTES`.
- Stream single-file responses (`c.body(file.stream())`) instead of buffering.
- Consider caching the assembled zip per `(id, published_at)`.

---

## ISSUE-6 — Tokens never expire, carry no scope, and can mint more tokens

**Severity:** High · **Where:** `apps/api/src/auth/middleware.ts:75`, `apps/api/src/routes/users.ts:82`, `apps/api/src/db/schemas/token.ts`

- `tokens` has no `expires_at`. A leaked CLI or MCP token is valid until someone notices it.
- `requireAuth` accepts a Bearer token on **every** route. That includes `POST /users/me/tokens`,
  so a stolen token can mint fresh tokens that survive revocation of the original. It also includes
  every admin route when the owner is an Admin.
- ADR-0035 calls the MCP token "scoped to `publish_skill`". It is scoped only in the sense that the
  MCP server uses it for one call. Server-side it has the owner's full role, and an agent process
  holds it unattended.

**Fix:**
- Add `expires_at` (default e.g. 90 days, chosen at mint time) and `scopes text[]` (e.g.
  `publish`, `read`). Enforce both in `resolveTokenUser`, with a `requireScope` middleware on write
  routes.
- Refuse token-authenticated requests to `/users/me/tokens*`, `/users/me/password`, and admin
  routes. Those are session-only actions.
- The web UI should offer a "publish only" scope for MCP/CI tokens.

---

## ISSUE-7 — Login rate limiting keys on a spoofable header; nothing else is rate limited

**Severity:** High · **Where:** `apps/api/src/auth/instance.ts` (no `rateLimit` / `advanced.ipAddress` config), `apps/api/src/app.ts`

- Better Auth's built-in limiter runs only under `NODE_ENV=production` and keeps its state in
  process memory (one bucket per replica). It gets the client IP **only** from
  `x-forwarded-for` (`@better-auth/core/dist/utils/ip.mjs`, `DEFAULT_IP_HEADERS`). When the app is
  reached directly (the Compose setup publishes port 3000), a client picks its own IP per request
  and bypasses the password sign-in limit. The same spoofed value is stored in
  `sessions.ip_address`.
- Nothing outside `/api/auth/*` is limited: Bearer-token guessing (cheap, since tokens are 256-bit,
  but each guess costs a DB query), `POST /setup`, zip assembly (ISSUE-5), `GET /resources?q=`
  full-text search, and the import routes that fan out to GitHub.

**Fix:**
- Configure `advanced.ipAddress.ipAddressHeaders` for the deployment's real proxy header (or
  `trustedProxies`). Set `rateLimit: { enabled: true, storage: "database" }` so it holds across
  replicas and in every environment.
- Add a general limiter middleware (e.g. `hono-rate-limiter`) on `/api/*`, with tighter buckets for
  `/setup`, `/resources/:id/artifact`, and `/imports/*`.

---

## ISSUE-8 — No security headers on the SPA or API (CSP, clickjacking, HSTS)

**Severity:** Medium · **Where:** `apps/api/src/app.ts`

No middleware sets `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`,
`Referrer-Policy`, `Strict-Transport-Security`, or `X-Content-Type-Options` on the SPA shell or on
JSON responses. The admin Settings pages can be framed (clickjacking), and a CSP would have
contained ISSUE-1 and ISSUE-16.

**Fix:** `app.use("*", secureHeaders({...}))` from `hono/secure-headers`, with a real CSP for the SPA.
Monaco needs `worker-src blob:` and the inline-style allowances Vite emits. Set HSTS when
`PUBLIC_URL` is https.

---

## ISSUE-9 — IdP and Integration client secrets stored in plaintext; one key reused for HMAC and encryption

**Severity:** Medium · **Where:** `apps/api/src/db/schemas/identity-provider.ts:36`, `apps/api/src/db/schemas/integration.ts:42`, `apps/api/src/services/connections.ts:613`, `:759`

- Connection access/refresh tokens are encrypted with `symmetricEncrypt`, but
  `identity_providers.client_secret` and `integrations.client_secret` are stored as plaintext. A
  database dump or backup leak exposes the OAuth app credentials. The GitHub App secret is enough
  to exchange refresh tokens for every writer's Connection. The code already notes this in
  `db/schemas/connection.ts:47`.
- `BETTER_AUTH_SECRET` is used directly as the Better Auth signing key, the AES key for
  Connection tokens, and the HMAC key for the connect-flow state, with no domain separation.

**Fix:** encrypt both `client_secret` columns with the same helper (a migration re-encrypts
existing rows). Derive per-purpose keys with HKDF, e.g. `hkdf(secret, "skillset:connection-state")`.

---

## ISSUE-10 — Changing a password does not revoke other sessions or tokens

**Severity:** Medium · **Where:** `apps/api/src/services/users.ts:172`

`replaceOwnPassword` updates the hash and clears `must_change_password`, but other sessions stay
valid for up to 7 days and tokens stay valid forever. A user who changes their password because
they suspect compromise is still compromised. An Admin also has no way to force-logout a User short
of deleting them.

**Fix:** in the same transaction, delete the user's other `sessions` rows (keep the current one),
and offer "also revoke all tokens" in the UI. Add an admin "sign out everywhere" action.

---

## ISSUE-11 — Any writer can silently replace any Skill that agents then load

**Severity:** Medium (design accepted in ADR-0002 — reconsider for release) · **Where:** `apps/api/src/services/resources.ts` (`publish`, `onConflictDoUpdate`)

A Skill is instructions plus scripts that coding agents execute with the developer's permissions.
`PUT /resources/skill/:name` upserts on name for **any** writer. The previous publisher is not
checked or notified, and there is no history. `add_skills` in the MCP server returns `SKILL.md`
straight into the agent's context. So one compromised writer account, or one writer token leaked
from CI or an MCP config (ISSUE-6), can replace the most-installed Skill with a malicious one. The
only trace is `published_by`, and bucket versioning is the only recovery.

ADR-0002 made this choice deliberately for a single trusted team. The supply-chain threat model is
not discussed there.

**Fix (pick a level):** an append-only audit table of publishes (who, when, previous `published_by`,
manifest hash); a "protected" flag that limits republishing to the original publisher or an Admin;
notification to the previous publisher on overwrite; show "last changed by X, N minutes ago" on the
Skill page and in `add` output.

---

## ISSUE-12 — `publish_skill` can publish any directory on disk

**Severity:** Medium · **Where:** `apps/mcp/src/tools/publish-skill.ts:163`

`path` is supplied by the model and resolved with `resolve(deps.cwd, path)`. An absolute path or
`../..` escapes the project. The walk then uploads every non-dot file below that directory. A
prompt injection (for example, from a Skill the agent just installed; see ISSUE-11) can tell the
agent to publish a directory containing secrets, which then become world-readable (ADR-0013).

**Fix:** refuse any `targetPath` that is not inside `deps.cwd`, checked after `realpath`. Consider
listing the files and total size in the tool result so the user sees what left the machine.

---

## ISSUE-13 — The migration advisory lock can be taken and released on different connections

**Severity:** Medium · **Where:** `apps/api/src/db/migrate.ts:44`, `:48`

`runMigrations` issues a **session-level** `pg_advisory_lock` and `pg_advisory_unlock` as two
separate statements on a postgres.js **pool**. `services/setup.ts` explains exactly why this is
unsafe and uses an xact lock instead. The unlock can run on a different backend: it returns
`false`, and the lock stays held by an idle pooled connection. A second replica, or this one after
a crash-restart that reuses the pool, will then block on `pg_advisory_lock` forever at boot.

**Fix:** `const reserved = await sql.reserve()`, then lock, migrate, and unlock on `reserved`, and
call `reserved.release()`. Or run migrations in a one-shot job before replicas start.

---

## ISSUE-14 — Known-vulnerable versions of hono, drizzle-orm and transitive packages

**Severity:** Medium · **Where:** `bun.lock`

`bun audit` reports 30 advisories (9 high). The ones that matter at runtime:

| Package | Installed | Fixed in | Note |
|---|---|---|---|
| `hono` | 4.13.3 | 4.13.5 | 3 moderate (query parsing after `#`, `parseBody` nesting DoS, `toSSG`) |
| `drizzle-orm` | 0.36.4 | 0.45.2 | High: SQL injection via identifier escaping. Not exercised by current code (no dynamic identifiers), but it is the API's data layer and very far behind |
| `fast-uri` | 3.1.5 | 3.1.6 | High (SSRF/host confusion), transitive via ajv |
| `qs` | 6.15.3 | 6.16.0 | Via `@modelcontextprotocol/sdk` → express |
| `undici`, `js-yaml`, `uuid` | — | — | Dev/tooling paths (testcontainers, shadcn, eslint) |

**Fix:** `bun audit fix`, bump `hono` and `drizzle-orm` (plus `drizzle-kit`) explicitly, re-run the
suite, and add `bun audit --audit-level=high` to CI.

---

## ISSUE-15 — Non-concurrent materialized view refresh every 30 s on every replica

**Severity:** Medium · **Where:** `apps/api/src/services/analytics.ts:65`, `apps/api/src/server.ts:46`, `apps/api/drizzle/0007_resources.sql`

`REFRESH MATERIALIZED VIEW resource_analytics` without `CONCURRENTLY` takes an `ACCESS EXCLUSIVE`
lock. `resource_directory`, which backs `GET /resources`, joins it, so catalog reads block for the
duration of each refresh. The refresh is a full aggregate over an unbounded event log. The default
cron `*/30 * * * * *` is **every 30 seconds**, and it runs on every replica.

**Fix:** add a unique index on `resource_analytics(resource_id)` and use
`.refreshMaterializedView(resourceAnalytics).concurrently()`. Run the refresh on one instance
(guard it with `pg_try_advisory_xact_lock`). Default to minutes, not seconds.

---

## ISSUE-16 — Rendered markdown allows `<style>`, remote images and forms

**Severity:** Medium · **Where:** `apps/web/src/lib/render-skill-body.ts:31`

DOMPurify's default profile removes script, but a publisher still controls:
- `<style>` blocks and `style` attributes, which can restyle or overlay the whole app (fake
  "session expired, enter password" UI; UI redress over admin controls),
- `<img src="https://attacker/…">` tracking pixels that log every reader's IP and timing,
- `<form>`/`<input>` elements.

**Fix:** `DOMPurify.sanitize(html, { FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select"], FORBID_ATTR: ["target", "style"] })`.
Restrict `img-src` via the CSP from ISSUE-8, or rewrite remote images to click-to-load.

---

## ISSUE-17 — No Origin check on cookie-authenticated mutations; JSON parsed without a content-type check

**Severity:** Medium (defence in depth) · **Where:** `apps/api/src/app.ts`, `apps/api/src/http/body.ts`

Custom routes (`POST /users`, `POST /users/me/tokens`, `PUT /resources/...`, `PATCH /identity-providers/:id`, …)
accept the Better Auth session cookie and rely on its `SameSite=Lax` default alone. `parseBody` and
`readJsonObject` call `c.req.json()` without requiring `content-type: application/json`, so a
cross-site `text/plain` form post parses as JSON. `SameSite=Lax` blocks this today, but it does not
cover sibling subdomains (same-site), older browsers, or a future cookie-config change.

**Fix:** `api.use(csrf({ origin: publicUrl }))` from `hono/csrf` on non-GET routes, and reject bodies
whose content type is not `application/json`. `@hono/zod-validator` does the latter for free (see
patterns.md).

---

## ISSUE-18 — Container runs as root; images unpinned; Compose defaults are unsafe for anything but local dev

**Severity:** Medium · **Where:** `Dockerfile`, `docker-compose.yml`

- The runtime stage has no `USER`. Bun runs as root in the container. Add `USER bun` (the image
  ships that user) and make `/app` read-only.
- `oven/bun:1`, `minio/minio:latest` and `minio/mc:latest` are floating tags. Pin versions or
  digests.
- No `HEALTHCHECK`, even though `/api/health` exists.
- The README presents Compose as "Running it". Compose publishes MinIO's API and console
  (`9000`, `9001`) with `minioadmin` defaults, sets `MINIO_API_CORS_ALLOW_ORIGIN: "*"`, and uses
  `postgres/postgres`. Either label the file dev-only or read these from `.env` with no defaults.
- Postgres has no healthcheck, so `depends_on: service_started` races. The app's own retry loop
  covers it, but a `pg_isready` healthcheck is the idiomatic fix.

---

## ISSUE-19 — Admin actions logged without the actor; no request log or request id

**Severity:** Low · **Where:** `apps/api/src/services/users.ts:129`, `:226`, `:258`; `apps/api/src/app.ts`

"user role changed" and "user removed" log the target but not **who** did it (`actor.id` is
available). The same gap applies to Identity Provider and Integration changes. There is no
per-request access log or request id, so an incident cannot be traced. Pino's redaction covers
only one level (`*.authorization`), so a future `logger.info({ req })` would leak
`req.headers.authorization` and cookies.

**Fix:** include `actor_id` on every admin mutation log (or add an `audit_events` table). Add
`requestId()` plus a pino request logger middleware. Add `req.headers.authorization`,
`req.headers.cookie`, and `**.client_secret`-style wildcard paths to `REDACT_PATHS`.

---

## ISSUE-20 — No request body size limit or handler timeout

**Severity:** Low · **Where:** `apps/api/src/app.ts`

JSON bodies are read in full before validation. Bun's default `maxRequestBodySize` is 128 MB. The
largest legitimate body is a publish manifest (≤1000 entries).

**Fix:** `api.use(bodyLimit({ maxSize: 1 * 1024 * 1024 }))` from `hono/body-limit`, and pass
`maxRequestBodySize` to `Bun.serve`. Consider `hono/timeout` on the import routes.

---

## ISSUE-21 — No graceful shutdown

**Severity:** Low · **Where:** `apps/api/src/server.ts`

There are no `SIGTERM`/`SIGINT` handlers. A rolling deploy kills in-flight zip builds and uploads,
leaves the cron task running, and drops pooled connections without `sql.end()`.

**Fix:** keep the `Bun.serve` handle. On `SIGTERM`: `server.stop()`, stop the cron task, `await sql.end({ timeout: 5 })`.

---

## ISSUE-22 — Tokens accepted over plain `http://`; MCP token passed on argv

**Severity:** Low · **Where:** `apps/cli/src/commands/login.ts`, `apps/mcp/src/config.ts`

- `skillset login --registry http://…` stores the token and sends it in cleartext on every call.
  Warn, or refuse, for non-`https` registries other than localhost.
- `--token <secret>` puts the secret in shell history (CLI) and in the process list and the
  checked-in `.mcp.json` (MCP). Prefer `SKILLSET_TOKEN` in docs and examples, and warn when the
  flag is used.

---

## ISSUE-23 — Install counts can be inflated by anyone

**Severity:** Low · **Where:** `apps/api/src/routes/resources.ts` (`/artifact`), `apps/api/src/services/analytics.ts`

Every unauthenticated `GET /resources/:id/artifact` inserts an event, with no deduplication. The
table grows without bound (see ISSUE-15), and the "installs" sort can be gamed. The client also
sets `source`. This is fine if the counts are informal. If not, dedupe per (resource, IP/UA, day)
and add a retention/rollup job.

---

## ISSUE-24 — Concurrent publishes of one name interleave prune and upload

**Severity:** Low · **Where:** `apps/api/src/services/resources.ts` (`publish`, `pruneArtifactFiles`)

Two publishes of the same Skill each prune the other's files and hand out presigned URLs for the
same keys. The stored artifact can end up as a mix of both manifests, and nothing detects it. A
`pg_advisory_xact_lock(hash(kind, name))` around the upsert and prune closes most of this. Fully
closing it needs a "pending upload" state or an upload-complete callback.

---

## ISSUE-25 — README quick start fails as written; README contradicts code and `.env.example`

**Severity:** Low (a release blocker for first-time users) · **Where:** `README.md`, `.env.example`, `docker-compose.yml`

- The README says to set only `BETTER_AUTH_SECRET` and `PUBLIC_URL`. But Compose passes
  `STORAGE_BUCKET: ${STORAGE_BUCKET:-}` (empty) and `.env.example` leaves it empty, so
  `loadConfig` throws "Missing required environment variable STORAGE_BUCKET". `STORAGE_ENDPOINT`
  also defaults to empty, which points Bun's S3 client at AWS rather than the bundled MinIO.
  Default these to `skill-registry`, `http://minio:9000` and `http://localhost:9000` for Compose.
- The README says to register the redirect URI as `<PUBLIC_URL>/api/auth/callback`. Better Auth
  uses `/api/auth/callback/<kind>`, which `.env.example` gets right.
- The README says "A Provider cannot be enabled without a permitted Workspace domain or Entra
  tenant". ADR-0021 and `IdentityProvidersService.create` allow exactly that (see ISSUE-2).
- The README lists the workspace as api/web/cli/shared. It omits `apps/mcp` and
  `packages/installer`, and says tests are "apps/api" only.
- `apps/api/tsconfig.tsbuildinfo` and `packages/shared/tsconfig.tsbuildinfo` are tracked even
  though `.gitignore` lists them. Run `git rm --cached` on both.

---

## ISSUE-26 — Code-quality and maintainability findings

**Severity:** Low · See `patterns.md` for the recommended structure.

1. **Route matching depends on registration order.** `routes/resources.ts` has comments saying
   `/resources/stats` must precede `/resources/:id`, and `/resources/:id/tags` must precede
   `/resources/:kind/:name`. `routes/auth.ts` has the same constraint. This breaks silently when
   someone reorders or adds a route. Constrain params (`/:id{[0-9a-f-]{36}}`) or give routes
   distinct shapes.
2. **Path params are not validated at the edge.** Services catch Postgres `22P02` (`isInvalidIdSyntax`,
   `selectByIdOrUndefined`, `z.uuid()` checks in `UsersService`) to turn a malformed id into a 404.
   Validate `:id` with a zod param validator in the route and delete that plumbing.
3. **Two validation styles.** Some routes use `parseBody(c, Schema)`. Others pass
   `readJsonObject(c)` into services that validate field by field (`publish`, `setSkillTags`,
   `rename`). The result is two error paths (`AppError` vs `SkillValidationError`/`TagValidationError`)
   and no typed request for those routes. Standardise on `zValidator` with the shared schemas.
4. **Hand-maintained `docs/openapi.json` has drifted.** It is missing `POST /imports/{provider}/skills`,
   `GET /imports/{provider}/repositories`, and `GET /resources/{id}/installs/trend`. Generate it from
   the routes (`@hono/zod-openapi`).
5. **Naming drift after ADR-0026.** Resource routes still parse `SkillSchema`,
   `SkillDirectoryPageSchema`, `SkillPublishedSchema`; the stats payload is `{ skills, publishers, installs }`;
   `AnalyticsService` takes `skillId`; `tags.setSkillTags`. The code says "Resource" at the edge
   and "Skill" underneath, and the services say "ticket 3 generalises this". Pick one name per
   concept before a second Kind lands.
6. **Comment volume works against CLAUDE.md** ("Don't add unnecessary comments"). Many functions
   carry 20–40 lines of history ("used to be…", ticket numbers, ADR narrative) above a few lines of
   code, e.g. `auth/instance.ts`, `services/resources.ts`, and `http/errors.ts` at 469 lines, mostly
   prose. Keep behaviour and constraints in the code comment. Move history to the ADRs and commit
   messages.
7. **`ARTIFACT_UPLOAD_EXPIRY_SECONDS` comment** says "up to the 10 MiB an Artifact may be". The
   limit being uploaded against is 25 MiB uncompressed per file set.
8. **Services do HTTP-shaped work.** `ResourcesService` returns `SkillUpload` with presigned URLs,
   `ImportsService` builds provider URLs and interprets status codes, and every service throws
   `AppError` subclasses from `http/errors.ts`. That is acceptable at this size, but it means
   services import from the HTTP layer. Consider moving domain errors next to their feature, with
   the HTTP mapping in one place.
9. **Web app:** a hand-rolled router (`lib/router.tsx`) plus string-matched pathnames in `App.tsx`.
   Settings sub-pages and the users list's `page` live in `useState` rather than the URL.
   `publish-skill-form.tsx` is 803 lines. Consider TanStack Router, which pairs with the TanStack
   Query already in use and gives typed params, search-param state, and route-level code splitting.
10. **Lint warnings:** 7 `react-refresh/only-export-components` warnings. Move the exported
    non-components (`provider-icons.tsx`, `theme-provider.tsx`, `ui/badge.tsx`, `ui/sidebar.tsx`)
    into their own modules.
11. **`resolveTokenUser` writes `last_used_at` on every authenticated request.** Throttle it (only
    update when older than, say, 5 minutes) to avoid a write per CLI call.
