# Demotion below `writer` clears Connections

## What to build

Dropping a User below `writer` deletes their Connections, in the same operation that changes the role.

The route gate already refuses the import, so this is not about access control — it is about not
storing a live repository credential for somebody who cannot use it. An operator asking "whose
repository credentials do we hold?" should get an answer that matches who can actually import, and
ADR-0024's whole case rests on that set being enumerable.

## Acceptance criteria

- [ ] Demoting a User from `writer` (or above) to `reader` deletes their Connections.
- [ ] The deletion and the role change are one transaction: a failure leaves neither applied.
- [ ] Promoting a User does not create anything — they connect for themselves.
- [ ] A role change that stays at or above `writer` leaves Connections alone.
- [ ] Removing a User deletes their Connections, via `ON DELETE CASCADE` on `user_id`.
- [ ] The Users list reflects the cleared Connection immediately.

## Blocked by

- 02 — Connections and the connect flow

---
GitHub: #38
Spec: `.scratch/github-import/spec.md`
ADR: `docs/adr/0024-import-is-a-github-app-and-login-stays-an-oauth-app.md`
