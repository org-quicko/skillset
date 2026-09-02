# Connections and the connect flow

## What to build

The `connections` table and the four routes that manage one. A **Connection** is a writer's own grant
of repository access, made deliberately and separately from signing in. Its existence *is* the
consent; nothing else records it.

Better Auth is **not** involved. It models accounts and identities, and a Connection is neither —
nobody signs in by connecting. Reaching for `genericOAuth` is exactly what pushed ADR-0023 into
storing a repository credential in the authentication table. The flow is ours: two routes, a signed
single-use `state`, and a form POST for the token exchange.

```
connections
  id                        uuid primary key default uuidv7()
  user_id                   uuid not null references users(id) on delete cascade
  provider                  text not null references integrations(provider) on delete restrict
  external_account_id       text not null             -- provider's own id, stable across renames
  external_account_login    text not null             -- shown in the UI
  access_token              text not null             -- ciphertext
  refresh_token             text                      -- ciphertext; null when none was issued
  expires_at                timestamptz               -- null means the token does not expire
  refresh_token_expires_at  timestamptz
  created_at / updated_at
  unique (user_id, provider)
```

Tokens are encrypted with Better Auth's `symmetricEncrypt` under the auth secret — the same scheme
`github-import.ts` already decrypts with; move `isEncrypted`'s hex sniff across with them.

Connecting sends the writer to the app's **installation** page, not a plain authorize URL:
`https://github.com/apps/{app_slug}/installations/new?state=…`. That page does repository selection
and user authorization in one pass, which is what gives a writer control over which repositories the
Registry may read.

## Acceptance criteria

### The table

- [x] Migration creates `connections` as above, with `refresh_token`, `expires_at`, and
      `refresh_token_expires_at` **nullable** — a GitHub App with token expiry switched off issues a
      non-expiring token and no refresh token, and connecting must not fail because an operator
      chose that. Null `expires_at` means "never", which is why it has no default. Both token
      columns carry a comment saying they hold ciphertext, not tokens (code comments in the schema
      file and the migration header, as `COMMENT ON COLUMN` is not used anywhere in this repo).
- [x] `ON DELETE RESTRICT` on `provider`: deleting an Integration that writers still hold Connections
      against fails, rather than orphaning credentials.
- [x] A Connection naming a provider with no `integrations` row cannot be inserted.
- [x] `unique (user_id, provider)` holds; reconnecting replaces rather than duplicating.

### The flow

- [x] `GET /connections/:provider/start` requires `writer`, and redirects to the Integration's
      installation URL built from `app_slug`.
- [x] The `state` is random, single-use, HMAC'd with the auth secret, bound to **the calling User**,
      and expires in five minutes. The nonce that makes it single-use lives in an httpOnly,
      `SameSite=Lax` cookie rather than server-side.

      Amended from "bound to the session id … held server-side". Binding to the User closes the
      attack that matters — an attacker walking a victim's browser through their own authorization
      to attach their account to the victim's — while a session-id binding would only additionally
      refuse a writer's *own* second session, which is the same person. And a cookie gets
      single-use and same-browser without a new table or a job to sweep expired rows out of it.
      `Lax` is required rather than chosen: the callback is a top-level GET navigation from the
      provider, and `Strict` would withhold the cookie on exactly that request.
- [x] `GET /connections/:provider/callback` validates and **burns** the `state` before doing anything
      else. A missing, tampered, expired, replayed, or other-**User** `state` is refused and writes no
      Connection. Each covered separately — this is the CSRF surface and the one thing not to get
      wrong. Replay is proven by two tests together rather than one: the callback clears the nonce
      cookie on every path out, and a callback with no matching nonce cookie is refused.
- [x] The exchange posts to `https://github.com/login/oauth/access_token` with the Integration's
      client id and secret, reads the account via `GET /user`, and upserts on `(user_id, provider)`.
- [x] `DELETE /connections/:provider` requires `writer` and deletes the row and nothing else. It does
      not touch a `github` sign-in account row.
- [x] `GET /connections` requires `writer` and returns the caller's own Connections: provider, account
      login, connected at.
- [x] No token appears in any response body, on any route, in any shape. Assert it directly.
- [x] A reader is refused on all four routes.
- [x] Redirects are not followed on any outbound provider request.

### Refresh

- [x] A helper returns a usable access token for a Connection, refreshing first when `expires_at` is
      within a minute — not when it has already passed.
- [x] A refresh GitHub refuses raises `connection_expired` and deletes nothing.
- [x] A refresh token past `refresh_token_expires_at` is not sent to GitHub at all; it raises
      `connection_expired` directly.
- [x] The refreshed token and its new expiry are persisted, encrypted.

### Docs

- [x] `docs/data-model.md` and `docs/openapi.json` updated. `CONTEXT.md` needs no change —
      **Connection** is already defined there.

## Blocked by

- 01 — Integration table and Admin configuration

---
GitHub: #34
Spec: `.scratch/github-import/spec.md`
ADR: `docs/adr/0024-import-is-a-github-app-and-login-stays-an-oauth-app.md`
Data model: `docs/data-model.md` · API: `docs/openapi.json`
