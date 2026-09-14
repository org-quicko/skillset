# Provider Credentials Are Read At Instance Construction

Better Auth takes `socialProviders` when an instance is constructed, not per request, but ADR-0015
requires an Admin to add a Provider from the browser with no redeploy. Both hold at once by
splitting the configuration in two: **credentials** are read from `identity_providers` when the
instance is constructed, and the instance is cached on a version key derived from that table so a
credential change reconstructs it; the **organisation gate and the enabled flag** are read from the
table on every login instead, and never go stale.

The version key is the row count and `max(updated_at)` over the table — the same
cache-key-by-`updated_at` shape the OIDC discovery cache already used, one level up.

## Considered Options

**Provider configuration in environment variables**, which is what "static at init" naturally
suggests and what most self-hosted applications do. Rejected for the reason ADR-0015 first rejected
it: adding a Provider from the browser without a redeploy was the requirement, not a nicety. It also
gets the bootstrap backwards — an operator would have to hold client credentials before their first
boot, when the whole point of the password path is that they configure the Provider after signing in.

**Constructing an instance per request.** Correct, and rejected as waste: it rebuilds the whole
configuration on every call to serve a table that changes a few times in a deployment's life.

**The `sso` plugin's per-request database lookup**, which is the direct solution to this exact
problem. Rejected in ADR-0016 for reasons that have nothing to do with this decision — it cannot
express GitHub — but it is the option a reader will ask about, and if GitHub ever left the picture
it would be the better mechanism.

## Consequences

**Staleness is safe by construction, and this is the property the whole design rests on.** A cached
instance can only be stale in its credentials. It cannot be stale in whether a Provider is enabled,
nor in which organisation that Provider admits, because both are read live at login. So the worst a
stale instance can do is fail a login for a Provider added moments ago — never admit someone a
disabled Provider should have refused, and never admit an organisation an Admin has just removed.
Any future field must be sorted into the right half deliberately: anything that gates *who gets in*
belongs in the live half, whatever the convenience of putting it in the other.

**Reconstruction is cheap because the built-in providers do no discovery.** Google, GitHub, and
Microsoft have hardcoded endpoints (Microsoft's derive from its tenant), so constructing an instance
allocates objects and touches the network not at all. This is what makes lazy reconstruction viable
rather than something to engineer around, and it is a concrete reason the built-ins beat
`genericOAuth` here (ADR-0016).

**Several processes converge without coordination.** Each derives the key from the shared table, so
each picks up a credential change on its own next authentication request. No pub/sub, no restart, no
sticky routing. One API container runs today, so this is headroom rather than a requirement — but it
is headroom that cost nothing.

**One failed login is possible immediately after adding a Provider**, if someone clicks its button
before any request has reconstructed the instance. It succeeds on retry. Reconstructing eagerly on
the settings write would close the window in-process, and is an optimisation rather than a
correctness fix — the version key is what makes it correct, and would still be needed for every
other process.

**In-flight logins survive a reconstruction.** Better Auth persists the OAuth state — the PKCE code
verifier, the callback URL, and the CSRF nonce — as a row in the `verifications` table, not in the
instance, so a login begun against one instance completes against its replacement. Confirmed against
better-auth 1.7.2 rather than assumed: `storeStateStrategy` defaults to the database and takes
`"cookie"` as its opt-in alternative, which would be the fallback if that default ever changed.
