-- Clears the OAuth tokens stored against GitHub *logins* (ADR-0024).
--
-- Nothing reads them any more. Repository access now comes from a Connection
-- granted against a separate GitHub App, and `GITHUB_SCOPES` no longer asks for
-- `repo`, so what is in this column is an encrypted copy of a credential the
-- Registry cannot use — pure liability in a leaked backup.
--
-- Hand-written rather than generated: this changes data, not schema, so
-- `db:generate` has nothing to produce. Idempotent by construction — a second
-- run matches no rows — and safe on a deployment that has never configured
-- GitHub, where it matches none to begin with.
--
-- `scope` is deliberately NOT cleared. It records what GitHub actually granted,
-- and GitHub has still granted `repo` to anyone who once agreed to it — scopes
-- accumulate on an OAuth App, so the grant outlives our decision to stop asking
-- for it. Clearing the column would make the row less truthful and would erase
-- the only record of which Users have a `repo` grant sitting at GitHub for them
-- to revoke. A row with a null token and a `scope` mentioning `repo` is correct.
--
-- Scoped to `provider_id = 'github'` on purpose. Google and Microsoft tokens are
-- untouched: neither is `repo`-shaped, and no decision has been taken about them.
-- `connections` is a different table entirely and is not touched either, so a
-- writer who connected before this lands keeps importing.
--
-- What this does NOT do, and must not be described as doing: it does not
-- withdraw the `repo` grants people already gave at GitHub. Those live in each
-- person's own GitHub authorizations, and revoking them from here would take
-- `DELETE /applications/{client_id}/grant`, which withdraws the entire
-- authorization and would face every existing user with a fresh consent screen
-- at their next sign-in. Deleting our copy is a real mitigation and a partial
-- one (ADR-0024).
UPDATE "accounts"
SET "access_token" = NULL,
    "refresh_token" = NULL,
    "access_token_expires_at" = NULL,
    "refresh_token_expires_at" = NULL,
    "updated_at" = now()
WHERE "provider_id" = 'github'
  AND (
    "access_token" IS NOT NULL
    OR "refresh_token" IS NOT NULL
    OR "access_token_expires_at" IS NOT NULL
    OR "refresh_token_expires_at" IS NOT NULL
  );
