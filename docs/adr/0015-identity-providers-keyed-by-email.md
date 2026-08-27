# Identity Providers Keyed by Email, Several at Once

The Registry gains external login: Google Workspace and Microsoft Entra, several Providers
enabled at once, configured by an Admin at runtime and offered on the login page beside the
password form. The implementation follows listmonk's, deliberately including the point
ADR-0007 chose to diverge on — a login is matched to a User by the verified email in the
provider's claims, not by its `sub` claim, and there is no `user_identities` table. A login
from a permitted domain creates the User if none exists. ADR-0007's subject-keying is
superseded; everything else in it stands.

## Considered Options

**Keying on the provider's `sub` claim**, which ADR-0007 specified and which this reverses. It
is the safer model and the argument for it did not change: `sub` is immutable, so a Workspace
rename follows the person instead of orphaning them. It was reversed because following one
reference implementation end to end is worth more here than a hybrid of listmonk's handshake
with our own identity model — the handshake is the part that is easy to get subtly wrong, and
the fewer places we depart from the implementation we are reading, the fewer places our
departure is the bug. The cost is recorded below rather than argued away.

**GitHub as a third Provider** was deferred, not rejected. listmonk's OIDC does discovery
against a provider URL; Google and Entra both publish a discovery document, so they are one
code path with different configuration. GitHub publishes none and issues no ID token, so it
needs OAuth2 plus a `GET /user` call and an org-membership gate — a second implementation
wearing the same button. It is a separate feature.

**A callback path per Provider** (`/auth/idp/{slug}/callback`) was rejected. listmonk already
round-trips a structured, base64-encoded `state` object; carrying the Provider's slug as a
field in it keeps a single registered redirect URI per console and leaves the handshake shape
untouched.

**Provider configuration in environment variables** was rejected: adding a Provider from the
browser without a redeploy was the requirement, so the configuration is a table.

**Holding the client secret outside the database** — encrypted at rest, or supplied per
Provider from the environment — was rejected in favour of listmonk's plaintext-in-settings,
for the same follow-the-reference reason as the identity model.

**listmonk's configurable default role** was rejected, and it is the one place this departs from
listmonk deliberately rather than because the shape would not carry over. listmonk lets an
operator choose which role auto-created users receive; here a User created by a login is always a
`reader`. ADR-0013 left `reader` granting nothing an anonymous visitor does not already have, so
it survives precisely as the tier you provision someone into ahead of promotion — which is exactly
what a self-serve login produces, leaving the knob nothing useful to select. What such a User
gains over a stranger is a Token they can mint for the CLI, and an identity an Admin can promote
to writer without creating it first. The security argument matters more than the simplicity one:
a configurable role would let the domain gate alone hand out `writer`, and publishing overwrites
a shared Skill (ADR-0002) — a larger grant than a domain match is meant to carry.

## Consequences

**The domain gate is the only control on who gets an account.** With just-in-time provisioning
and no pre-existing User required, `hd` for Google and `tid` for Entra are what stand between
the public internet and a User row. They are not defence in depth here; they are the door. A
Provider with no gate configured must not be enablable.

**Every enabled Provider can log into every account.** Email is an assertion, not an identity,
so the weakest enabled Provider defines who can reach any given User. This is safe only while
every Provider is a tenant we control. Enabling one that can assert an arbitrary verified email
— a consumer Microsoft account, or GitHub if it ever lands — turns first login into account
takeover. listmonk avoids this by supporting exactly one Provider; we do not have that
protection and must supply it by policy instead.

**A rename in the provider splits a person's history.** Changing someone's Workspace email
produces a second User on their next login rather than following the first, and the Skills they
published stay attributed to the old one. This is the concrete cost ADR-0007 keyed on `sub` to
avoid, accepted knowingly.

**The nonce cookie is bound to the Provider, not just to the flow.** The slug in `state` is
attacker-controllable; without binding, a flow begun against one Provider can be returned
against another.

**ADR-0007's predicted invariant change happens now.** Signup is closed except for logins from
a permitted domain. The `/setup` route remains unavailable once any User exists — that phrasing
still holds, which is why it was written that way.

**Password login stays.** It is the break-glass path when a client secret expires or a
Provider is misconfigured, and it is how the Superadmin configures the first Provider at all.

**The database now holds a live third-party credential.** Password hashes and Token hashes are
one-way; a client secret is not. A leaked backup is now an incident with Google or Microsoft,
not only with us.
