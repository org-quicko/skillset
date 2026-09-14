# Auth Shaped for OIDC, Identities Keyed by Subject

> **Partly superseded by ADR-0015.** Identities are keyed by verified email, not by the
> provider's subject claim, and there is no `user_identities` table — see ADR-0015 for why
> the divergence from listmonk argued below was reversed, and what it costs. The rest of this
> ADR stands: the nullable password, the session issuer taking a resolved User, and the
> handshake shape to copy.
>
> **Further superseded by ADR-0016**, which takes the last of it. The handshake is no longer
> ours to copy — Better Auth performs it. What still stands from this ADR is the smallest and
> most durable part: a password is optional on a User, and issuing a session takes an
> already-resolved User rather than a set of credentials. Both are what made this migration
> additive rather than a rewrite, which is the argument the ADR was making.

OIDC is coming, and the first provider will be Google Workspace. We are not building it now, but
three properties of the auth layer are cheap today and expensive to retrofit, so they are settled
now: a password is optional on a User, issuing a session takes an already-resolved User rather than
a set of credentials, and when external identities arrive they will be keyed by the provider's
subject claim rather than by email.

## Considered Options

**Matching an OIDC login on email** was rejected. Email stays the identifier a human uses, and it
is how an external identity is *linked* the first time — but Workspace emails are mutable, so
matching on email at every login means renaming someone in the admin console silently orphans their
account, their Tokens, and the attribution on every Skill they published. The provider's `sub` claim
is immutable and exists precisely for this.

**Building the identity table and a provider abstraction now** was rejected as speculative. A
provider interface with zero implementations teaches us nothing and will be wrong in ways we cannot
predict. Adding a table and a route later is a migration; having baked password authentication into
the session issuer would have been a rewrite.

## Consequences

`password_hash` is nullable. A User authenticating externally has none, and `must_change_password`
is meaningful only for Users who have one. Every code path that reads a password must tolerate its
absence rather than assuming a row implies a credential.

Authentication resolves a request to a User; authorisation then reads that User's current role from
the database (ADR-0005). Because the session token carries only the User's id and never how they
proved it, adding a second way to log in is additive — a new route that resolves a User and issues
the same session. Tokens are untouched for the same reason, which is why they were chosen over
password-based CLI login in the first place.

When OIDC lands it will add a `user_identities` table — User, provider, subject, unique on provider
and subject — and routes under authentication alongside login and logout. Two decisions are
deliberately deferred to that point, because they need a real provider in front of us: whether a
first external login auto-links to an existing User whose verified email matches within the allowed
Workspace domain, or refuses and requires an Admin to link it; and whether provisioning is
just-in-time.

## Prior art: listmonk

listmonk solves the same problem — self-hosted, password auth first, OIDC added later — and its
implementation was read before settling this. What we took from it, and where we knowingly differ:

**Taken.** A nullable password column, which it also has (`password TEXT NULL`). Auto-creation of
Users on external login gated by configuration, with a configurable default role — the shape of the
provisioning decision deferred above. Padding the login response to a floor of around 100 ms, so
response time does not reveal whether an email is known. And hashing high-entropy secrets with
SHA-256 compared in constant time, rather than with a password KDF.

The handshake shape is worth copying verbatim when the time comes, because it is the part that is
quietly easy to get wrong: the `state` parameter carries a base64-encoded object holding a nonce and
the post-login destination, the same nonce is set in a cookie, and the callback verifies the nonce in
the returned ID token against the cookie before trusting any claim. Without that, the callback is an
open redirect and a login-CSRF endpoint.

**Differed, deliberately.** listmonk has **no subject column at all** — it looks a User up by the
lowercased email from the provider's claims and auto-creates if absent. That is simpler, and it is
the reference implementation, so a reader comparing the two should know the divergence is a choice.
We key on subject because with auto-creation enabled an email change in the provider produces a
*second* User rather than an error, and this Registry attributes every Skill to a publisher — so a
duplicate User silently splits one person's history in two.

listmonk also stores sessions in Postgres, so its logout genuinely revokes. That is the alternative
ADR-0005 rejected, chosen by the closest comparable project; the trade-off there stands, but it was
not made in ignorance of the precedent.

## The invariant that changes

One invariant will change, and its test should be written to expect that. Today signup is closed
once the Registry has a User (ADR-0005 era rule from bootstrap-then-closed). With Workspace OIDC the
rule becomes closed *except* for identities from the permitted hosted domain — the `hd` claim, not a
string match on the email suffix. Do not write the current rule as "no User can ever be created
except by an Admin"; write it as "the initialisation route is unavailable once a User exists", which
stays true.
