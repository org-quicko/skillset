# 05 — Tokens

**What to build:** A User mints a Token so the CLI can act as them, sees it exactly once, and can revoke it. The API accepts a Token wherever it accepts a session.

**Blocked by:** 02 — First Admin and sessions.

**Status:** ready-for-agent

- [ ] A User mints a Token with a display name and is shown the secret exactly once, with no way to retrieve it afterwards.
- [ ] The secret is generated from a cryptographically secure source with at least 256 bits of entropy.
- [ ] Only a SHA-256 digest of the secret is stored — not an argon2id hash, because the secret is already high-entropy and a KDF would add latency to every CLI request.
- [ ] The digest is compared in constant time, so the comparison is not a timing oracle.
- [ ] A request bearing a valid Token is authenticated as its owner, with the owner's current role resolved from the database on that request.
- [ ] A Token's last-used time updates as it is used.
- [ ] Revoking a Token causes the very next request bearing it to fail.
- [ ] A Token grants no more than its owner's role — a reader's Token cannot publish.
- [ ] Tokens are listed with display name, created-at, and last-used-at, and the secret appears in no listing.
- [ ] The minted secret is never written to the client's cached server state.
- [ ] A User sees and revokes only their own Tokens.
