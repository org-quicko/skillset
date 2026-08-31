# Authentication on Better Auth

## What to build

The Registry's authentication moves onto Better Auth, and GitHub joins Google Workspace and
Microsoft Entra as a way to sign in. An Admin configures each Provider in the web interface —
credentials and the organisation it admits — and every enabled one appears as a button on the login
page beside the password form. Signing in through one either finds the User with that verified email
or creates them as a `reader`.

What a person sees barely changes. What changes underneath is that sessions, password verification,
and the OAuth handshake are Better Auth's rather than ours, and that a third button can appear.

Settled in ADR-0016 through ADR-0019. The identity model is unchanged from ADR-0015: a login is
matched to a User by verified email, there is no `user_identities` table, and the organisation gate
is the only control on who gets an account.

## Decisions

Repeated here as the shape the criteria assume; each is argued in its ADR.

**Better Auth replaces the hand-rolled layer** (ADR-0016) — JWT sessions, argon2id verification, and
the `openid-client` handshake. Password login stays, through Better Auth. CLI Tokens stay ours,
untouched.

**One Provider per kind** (ADR-0017). Exactly one Google, one Microsoft, one GitHub. The `slug`
column goes, and with it the `state`-carries-the-slug machinery — Better Auth's callback path
carries the kind.

**GitHub is gated on organisation membership and a verified email** (ADR-0018), both checked on
every login. `permitted_domain` becomes `permitted_organisations` (a list, after ADR-0021): Workspace domains, tenant ids, or
an organisation login depending on kind.

**Credentials are read when the Better Auth instance is constructed; the gate and the enabled flag
are read on every login** (ADR-0019). The instance is cached on a version key over
`identity_providers`, so adding a Provider or rotating a secret needs no redeploy, and a stale cache
can never admit someone it should refuse.

**Nothing is configured before first boot.** An operator boots with no Provider, completes `/setup`,
signs in with a password, and adds the first Provider from the browser. The password path exists for
exactly this (ADR-0015) and is why it cannot be removed.

## Acceptance criteria

### Configuration

- [ ] `identity_providers` holds one row per kind (`google` | `microsoft` | `github`), unique on
      kind: display name, client id, client secret, `permitted_organisations` (a list, possibly empty), and an `enabled` flag.
- [ ] An Admin creates, edits, enables, and disables Providers from the web interface; readers and
      writers are refused.
- [x] ~~A Provider cannot be enabled without `permitted_organisation` set.~~ Reversed by ADR-0021: a
      Provider holds a list of `permitted_organisations` and may be enabled with none, which turns the
      check off. The refusal is gone; warnings in the interface, the service, and every login replace it.
- [ ] There is no route that deletes a Provider. Disabling one removes it from the login page and
      refuses logins through it, leaving the Users it created untouched.
- [ ] No API response ever includes a client secret, including the Admin's own read of the Provider
      it belongs to.
- [ ] Adding a Provider or changing its credentials takes effect without a restart: a login through
      it succeeds on a request after the change, with no redeploy and no new environment variable.
- [ ] Disabling a Provider, or changing its `permitted_organisations`, takes effect on the very next
      login — not on the next instance reconstruction.

### Login page

- [ ] An unauthenticated request can list the enabled Providers — kind and display name only. Reads
      need no identity (ADR-0013).
- [ ] The login page shows one button per enabled Provider above the password form, and the password
      form is always present regardless of how many Providers are configured.
- [ ] With no Provider enabled, the login page is exactly what it is today.
- [ ] A sign-in attempt against a disabled or unconfigured kind is refused by the API, not only
      hidden in the interface.

### Who gets in

- [ ] The organisation is the whole gate: no kind checks whether the provider considers the email
      verified (ADR-0018 records why, and what it costs for GitHub).
- [ ] Google: a login whose `hd` claim is not the Provider's permitted domain is refused — matched
      on the claim, never on the email's suffix.
- [ ] Microsoft: a login whose `tid` claim is not the Provider's permitted tenant is refused, on the
      same terms. A login carrying no `email_verified` at all is admitted, since Entra never sends
      one.
- [ ] GitHub: a login is refused unless the account is a member of the permitted organisation. The
      address is read from `/user/emails`, not `/user`, so a member who keeps theirs private is not
      locked out.
- [ ] Every gate is checked on every login, not only at account creation.
- [ ] A login whose verified email matches an existing User signs in as that User, whatever role
      they hold and whether or not they have a password.
- [ ] A login whose verified email matches no User creates one as a `reader` — fixed, not
      per-Provider configuration — with no password and `must_change_password` false.
- [ ] A User who first arrived through one Provider and later signs in through a second enabled
      Provider asserting the same verified email is the **same** User, not a second row.
- [ ] A refused external login returns to the login page with a reason, and issues no session. The
      reason names which check failed (ADR-0021 reverses the coarse single code), but never which
      organisation would have passed — that stays in the logs.

### Sessions and passwords

- [ ] A successful login of any kind issues the same session, carrying only the User's identity —
      the role is still resolved from the database on every request (ADR-0005).
- [ ] A demoted User's next request is authorised at their new role, whether they hold a session or
      a Token.
- [ ] Logging out revokes the session server-side. It is no longer merely a cleared cookie.
- [ ] Every password that verified before the migration verifies after it, the Superadmin's above
      all — locking them out removes the only way to configure a Provider.
- [ ] CLI Tokens authenticate exactly as before, and deleting one still takes effect immediately.
- [ ] The app refuses to boot without `BETTER_AUTH_SECRET`, and refuses to boot without `PUBLIC_URL`.

### Invariants that must not drift

- [ ] The `/setup` route remains unavailable once any User exists.
- [ ] No external login can produce or alter a role above `reader`: a created User is always a
      `reader`, and a matched User's role is never touched by logging in, whatever it is.
- [ ] An operator can go from a fresh deployment to a working Google login without setting a single
      environment variable beyond the deployment's own URL and secret.
- [ ] `CONTEXT.md`, `docs/data-model.md`, `.env.example`, and `docs/openapi.json` are updated to
      match — including the callback path, which is now per kind (ADR-0016).

## Out of scope

Two-factor, passkeys, magic links, and Better Auth's `apiKey` plugin. Tokens already solve CLI
authentication and revoke immediately; the rest is capability nobody asked for.
