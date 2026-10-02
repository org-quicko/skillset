# Better Auth Owns Authentication

The hand-rolled authentication layer is replaced by Better Auth: JWT sessions become rows in a
sessions table, the `openid-client` handshake becomes Better Auth's built-in social providers, and
password login continues through its email-and-password support. ADR-0005's stateless-JWT half is
superseded; its per-request role resolution is not, and stays exactly as it is. ADR-0015's model —
a Provider is configured in a table by an Admin, and a login is matched to a User by verified email
— also stands, and is what the Provider table keeps feeding.

CLI Tokens are untouched. They are looked up by hash on every request and revoke immediately
(ADR-0005); Better Auth's `apiKey` plugin would be a second migration buying nothing.

## Considered Options

**Keeping the hand-rolled layer and adding GitHub to it**, which is what ADR-0015 planned. Rejected,
and it is worth being clear that this was not rejected because the code was bad — it works, it is
tested, and its handshake follows listmonk deliberately. It was rejected because every Provider we
add is a protocol implementation we own, and GitHub is the one that does not fit the OIDC path
(ADR-0018). Better Auth already has all three.

**The `sso` plugin**, which stores Providers in its own table and reads them per authentication
request — genuinely dynamic configuration, which is exactly what ADR-0015 asked for and what this
repo built a table for. Rejected on two counts. It requires `token_endpoint` and `jwks_uri` to
validate an ID token and offers no plain-OAuth2 mode, so GitHub cannot use it at all and would need
a second implementation anyway — the very split ADR-0018 exists to remove. And it would replace
`identity_providers` with its own `ssoProvider`, discarding the admin UI and routes that already
work, for a dynamism ADR-0019 obtains more cheaply.

**The `genericOAuth` plugin**, which can express all three Providers as data. Rejected: its config
is read once at plugin init just as `socialProviders` is, so it buys no dynamism over the built-ins,
while giving up their knowledge of each provider's quirks — GitHub's `/user/emails` call above all —
and re-running OIDC discovery over the network on every reconstruction. Built-in providers have
hardcoded endpoints, which is what makes ADR-0019's reconstruction cheap.

## Consequences

**Sessions become revocable.** ADR-0005 accepted "a session cannot be revoked before its JWT
expires" as the price of having no sessions table. There is a sessions table now, so that price is
no longer paid and the short expiry it forced can be relaxed. This is the one place the migration
makes the system strictly better rather than merely different.

**Every existing session is invalidated on deploy.** Different cookie, different format. Everyone
signs in again once. Tokens are unaffected, so the CLI does not notice.

**Password hashes survive.** Better Auth defaults to scrypt; we supply `Bun.password` argon2id
through `emailAndPassword.password.hash`/`verify` so existing hashes keep verifying, and the
credential moves from `users.password_hash` into an `accounts` row as part of the migration. Getting
this wrong locks out the Superadmin, who is the only person able to configure a Provider — and
therefore the only way back in.

**`PUBLIC_URL` becomes required**, where today it is optional and only an external login needs it.
Better Auth always wants a base URL. An instance that boots fine today will refuse to boot after
this, which is a deployment-breaking change and belongs in the release notes.

**`JWT_SECRET` becomes `BETTER_AUTH_SECRET`.** The reason ADR-0005 gave for refusing to generate one
still applies verbatim: a generated secret silently invalidates every session on restart.

**One callback path per kind, not one for all.** Better Auth's is `/api/auth/callback/{kind}`.
ADR-0015 deliberately chose a single shared path with the Provider carried in `state`, so this
contradicts it — but that decision existed to avoid registering several redirect URIs per console,
and each kind is a different console anyway, so nothing is actually lost. `.env.example` documents
the old path and must be corrected.

**We now depend on a third-party library for the security boundary.** Less code we own and test,
more surface we do not control. Concretely: a Better Auth advisory is now an incident for this
Registry, and upgrading it is a security activity rather than a chore. That is the trade, and it is
the usual one — the same reasoning that put `openid-client` here rather than a hand-written token
exchange, applied one level up.

**A Registry-created User is `email_verified` from the moment they exist**, and the flag does not
mean what its name suggests. This Registry has no address-verification step and sends no email at
all, so it cannot mean "we challenged this address". It means the Registry stands behind it — an
Admin naming someone's address is this system's assertion that it is theirs, which is already the
model CONTEXT.md describes when it calls the email address the identity.

Setting it is not tidiness. Better Auth refuses to link a Provider login to a local row whose email
is unverified — a defence against an attacker pre-registering an unverified row at a victim's
address so the victim's OAuth identity links into it. That attack needs the ability to create a row
at a chosen address, which here means being an Admin, who already outranks the target; and the
organisation gate runs on the link as well as on sign-in (ADR-0018), so a link can only ever come
from a tenant we control. Left false, the flag would instead break the thing ADR-0015 requires: a
login whose verified email matches an existing User signs in as that User, whether or not they have
a password. The first Google sign-in against the password Superadmin failed exactly this way, with
`account_not_linked`.

Better Auth's own escape hatch, `requireLocalEmailVerified: false`, was rejected: it is deprecated,
and its documentation says the gate becomes unconditional in the next minor. `trustedProviders` was
rejected too, and for a more interesting reason — reading the implementation shows the local-row
check is a separate disjunct that trusting a provider does not bypass, so it would have looked like
a fix without being one.
