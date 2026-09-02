# Strip `repo` from sign-in and stop storing its token

## What to build

Sign-in asks only for identity. `GITHUB_SCOPES` loses `repo`, keeping `read:user`, `user:email`,
`read:org`. The sign-in access token stops being persisted, and the ones already stored are cleared.

**This ticket must land after 04, not before.** Reversing that order breaks importing from private
repositories for the window between them: 04 is what moves the import off the login's token, and
until it lands that token is still the credential.

`read:org` stays and is load-bearing — without it `/user/orgs` returns an empty list for every member
and the organisation gate refuses every login (ADR-0018).

## Acceptance criteria

- [x] `GITHUB_SCOPES` is `["read:user", "user:email", "read:org"]`. Its docblock loses the paragraph
      explaining `repo`, and gains a line pointing at ADR-0024 for where repository access now comes
      from.
- [x] A GitHub sign-in stores no access token, asserted on the `accounts` row rather than on the
      configuration — driven through `internalAdapter.createAccount`/`updateAccount`, which is what
      Better Auth's own callback calls.
- [x] Unrequesting the scope is **not** the mechanism, only half of it. A database hook nulls the
      token fields on every `github` account write, create and update alike, because scopes
      accumulate on a GitHub OAuth App: anyone who once granted `repo` keeps being issued a
      `repo`-capable token here whatever `GITHUB_SCOPES` says.
- [x] The hook returns explicit `null`s rather than omitting the fields, and a test proves it. Better
      Auth *merges* what a `before` hook returns over the data it already had, so an omitted key is
      restored by that spread — a hook written to delete them reads as correct and stores the token
      anyway. This was a real defect in the first attempt, caught only because the test asserts on the
      row.
- [x] `accounts.scope` is deliberately left alone, and that is recorded in both the migration and
      `docs/data-model.md`. It reports what GitHub granted, and GitHub *has* still granted `repo`, so
      clearing it would make the row less truthful and erase the only record of who should go and
      revoke it.
- [x] A migration nulls `accounts.access_token` for `provider_id = 'github'` rows. Nothing reads them
      after 04, and a stored credential nothing reads is pure liability.
- [x] Signing in with GitHub still works, verified at the seams this repo has rather than end to
      end. The organisation gate is exercised as the decision function it is, `oauth_app_not_approved`
      branch included and still told apart from plain non-membership
      (`identity-providers.test.ts`); account linking is pinned at the configuration seam
      (`auth-schema.test.ts` on `trustedProviders` and `requireLocalEmailVerified`); and what a GitHub
      login asserts about its own address is covered by `github-identity.test.ts`.

      Amended from "end to end", which no seam here reaches: the redirect, the PKCE exchange, and the
      callback are Better Auth's and after ADR-0016 are not ours to exercise. Worth stating plainly
      that this change touches neither the gate nor the linking path — only the scopes requested and
      the token fields written — so what those suites prove is unchanged by it, and they still pass.
- [x] Existing Connections are unaffected. A writer who connected before this lands can still import.
- [x] `encryptOAuthTokens` stays on. Google and Microsoft tokens are unaffected by this ticket.
- [x] The migration is idempotent and safe to run against a deployment with no GitHub rows.

## Notes for whoever writes the release note

Two things are true and must not be overclaimed, both recorded in ADR-0024:

- Scopes **accumulate** on a GitHub OAuth App. Anyone who already granted `repo` will keep receiving
  `repo`-capable login tokens whatever the Registry asks for. Not storing them is the mitigation.
- The `repo` grants people have already given **cannot** be cleaned up from here.
  `DELETE /applications/{client_id}/grant` withdraws the whole authorization and would face every
  existing user with a fresh consent screen at their next sign-in. Those grants linger in each
  person's GitHub authorizations until they clear them.

## Blocked by

- 04 — Import route, running on Connections

---
GitHub: #36
Spec: `.scratch/github-import/spec.md`
ADR: `docs/adr/0024-import-is-a-github-app-and-login-stays-an-oauth-app.md`,
`docs/adr/0018-github-as-an-identity-provider.md` (why `read:org` stays)
