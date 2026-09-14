# Stateless JWT With Per-Request Role Resolution

> **Partly superseded by ADR-0016.** Sessions are Better Auth's and live in a table, so the
> trade-off accepted below — that a session cannot be revoked before its JWT expires — is no
> longer paid, and `JWT_SECRET` is now `BETTER_AUTH_SECRET`. The rest of this ADR stands, and
> is the half that mattered: the session still carries only the User's identity, never their
> role, and authorisation is still resolved from Postgres on every request.

Web sessions are a signed JWT in an `HttpOnly; Secure; SameSite=Strict` cookie, with no
sessions table. The JWT carries **only the user id — never the role**, so authentication is
stateless while authorisation is resolved from Postgres on every request.

## Consequences

Splitting it this way is the point. Roles gate deleting a Skill and managing Users, and the
last-Admin rule exists so nobody can be locked out of their own Registry — so a demoted Admin
keeping their privileges until a token expires would be a real hole, not a theoretical one.
Resolving the role per request closes it while keeping the no-session-table simplicity.

The trade-off we accepted: a session cannot be revoked before its JWT expires. Keep expiry
short. Token revocation is unaffected — Tokens are looked up by hash on every request, so
deleting one takes effect immediately.

`JWT_SECRET` must be supplied; the app refuses to boot without it rather than generating one,
because a generated secret silently invalidates every session on restart.
