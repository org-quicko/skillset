# External login with Identity Providers

## What to build

A team on Google Workspace should be able to reach the Registry without an Admin creating each
person by hand. An Admin configures one or more **Identity Providers** in the web interface; every
enabled one appears as a button on the login page beside the password form; signing in through one
either finds the User with that verified email or creates them.

The implementation follows listmonk's OIDC support, which solves the same problem for the same kind
of self-hosted deployment. The one place it cannot be followed is that listmonk supports exactly one
provider and this supports several — see Decisions.

Google Workspace and Microsoft Entra only. Both publish an OIDC discovery document, so they are one
code path with different configuration. GitHub is deliberately out of scope (ADR-0015).

## Decisions

Settled in ADR-0015; repeated here as the shape the criteria assume.

**A login is matched to a User by verified email, not by the provider's `sub` claim**, and there is
no `user_identities` table — the `users` row is the identity. This reverses ADR-0007, knowingly.
Two consequences drive several criteria below: the permitted domain is the *only* thing gating who
gets an account, and a rename in the provider produces a second User rather than following the
first.

**Configuration is a table, edited by an Admin at runtime**, client secret included. No new
environment variable, no redeploy to add a Provider.

**One callback path, with the Provider carried inside `state`.** listmonk's `state` is already a
base64-encoded object holding a nonce and the post-login destination; the Provider's slug becomes a
third field. Because that slug arrives back from the network, the nonce cookie is bound to it — a
flow begun against one Provider must not be completable against another.

**A User created by a login is always a `reader`**, fixed rather than configurable per Provider —
the one deliberate departure from listmonk. ADR-0015 records why.

**Providers are disabled, never deleted.** Deleting one is a config mistake, not a data-lifecycle
event.

**Configuration points at the issuer, not the discovery document.** `openid-client`'s
`discovery()` takes an Issuer Identifier and validates every ID token's `iss` against it;
handing it the discovery document's own URL is supported but silently disables that check.
The column is named `issuer_url` for that reason.

**Password login is untouched** and stays on the login page. It is the break-glass path when a
client secret expires, and it is how the first Provider gets configured at all.

## Acceptance criteria

### Configuration

- [ ] An `identity_providers` table holds, per row: an immutable slug, a kind (`google` |
      `microsoft`), the issuer URL, client id, client secret, the permitted hosted domain
      (Google `hd`) or tenant (Entra `tid`), and an `enabled` flag.
- [ ] An Admin creates, edits, enables, and disables Providers from the web interface; readers and
      writers are refused.
- [ ] A Provider cannot be enabled without a permitted domain or tenant set. This is the only
      control on who gets an account, so the refusal is a validation error naming the field.
- [ ] There is no route that deletes a Provider. Disabling one removes it from the login page and
      refuses logins through it, leaving the Users it created untouched.
- [ ] A Provider's slug cannot be changed after creation — the registered redirect URI in the
      provider's console depends on the deployment, not on the slug, but the slug is what `state`
      carries and what an operator matches up when reading logs.
- [ ] No API response ever includes a client secret, including the Admin's own read of the Provider
      it belongs to.

### Login page

- [ ] An unauthenticated request can list the enabled Providers — slug, kind, and display name only.
      Reads need no identity (ADR-0013).
- [ ] The login page shows one button per enabled Provider above the password form, and the password
      form is always present regardless of how many Providers are configured.
- [ ] With no Provider enabled, the login page is exactly what it is today.

### The handshake

- [ ] Starting a login redirects to the Provider's authorization endpoint with `state` carrying a
      base64-encoded object holding a nonce, the post-login destination, and the Provider's slug.
- [ ] The same nonce is set in a cookie, bound to that Provider's slug.
- [ ] The callback verifies the nonce in the returned ID token against the cookie, and that the slug
      in `state` matches the one the cookie was bound to, **before** trusting any claim. A flow
      begun against one Provider and returned against another is refused.
- [ ] The post-login destination in `state` is only honoured if it is a path within this Registry —
      an absolute URL elsewhere is discarded, not followed.

### Who gets in

- [ ] A login whose email claim is not verified is refused.
- [ ] A login whose `hd` (Google) or `tid` (Entra) is not the Provider's permitted one is refused —
      matched on the claim, never on the email's suffix.
- [ ] A login whose verified email matches an existing User signs in as that User, whatever role
      they currently hold and whether or not they have a password.
- [ ] A login whose verified email matches no User creates one as a `reader` — the role is fixed,
      not per-Provider configuration — with no password and `must_change_password` false.
- [ ] A User who first arrived through one Provider and later signs in through a second enabled
      Provider asserting the same verified email is the **same** User, not a second row.
- [ ] A successful external login issues the same session cookie as a password login, carrying only
      the User's id (ADR-0005).
- [ ] A refused external login returns to the login page with a reason, and issues no session.
- [ ] Password login continues to work unchanged for Users who have a password.

### Invariants that must not drift

- [ ] The `/setup` route remains unavailable once any User exists. Phrase the test that way — a
      login is now a third way for a User to come into existence, so "only an Admin creates Users"
      is false from this ticket on.
- [ ] No external login can produce or alter a role above `reader`: a created User is always a
      `reader`, and a matched User's role is never touched by logging in, whatever it is.
- [ ] `docs/data-model.md` and `docs/openapi.json` are updated to match.
