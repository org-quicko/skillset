# Web: Connection card, Integrations section, publish-form routing

## What to build

The interface for connecting, for configuring an Integration, and for importing with or without a
Connection. Follow the existing settings-page role-gating pattern; no new shadcn component is needed.

**One URL field, not two.** `publish-skill-form.tsx` keeps the single field it has. It parses the
pasted URL to discover the provider, then chooses its path on whether the writer holds a Connection:

| Writer | Public repository | Private repository |
|---|---|---|
| No Connection | anonymous, client-side (ADR-0010, unchanged) | fails; offers connect |
| Connection | **server-side** | server-side |

The one surprise there is a connected writer taking the server path for a *public* repository.
Anonymous GitHub allows sixty requests an hour per IP and the walk spends roughly one per file, so a
shared office address exhausts it in two or three imports; a token has five thousand. This reverses
ADR-0020's anonymous-first fallback, and ADR-0024 records why.

## Acceptance criteria

### Connection card

- [ ] On the settings page beside `tokens-card`, visible to `writer` and above, and **not offered to
      a reader** — a reader must not be invited to grant a credential they could never use.
- [ ] Shows connected state and the connected account's login, so a writer can tell which account an
      import runs as.
- [ ] Connect and disconnect actions.
- [ ] Copy states plainly that disconnecting stops **this Registry** using the grant rather than
      withdrawing it at the provider, and points the writer at GitHub to withdraw it entirely. This
      constraint is load-bearing: if the card says "revoked" without qualification, the product and
      ADR-0024 disagree, and the ADR is right.
- [ ] Before connecting, the writer is told what they are granting and that they choose which
      repositories.
- [ ] Hidden entirely when the provider has no Integration — there is nothing to connect to.

### Integrations section

- [ ] Beside `identity-providers-card`, **Admin only**, for `client_id`, `client_secret`, and
      `app_slug`.
- [ ] Placed and labelled so it is plainly not about identity: an Admin must not be led to believe
      they are configuring a way to log in.
- [ ] `client_secret` is never rendered back, because no response carries it.

### Users card

- [ ] A Connection column, so an Admin can answer "who has granted this Registry access to our
      repositories" without a database client.

### Publish form

- [ ] One URL field. The provider is discovered from the URL, not chosen by the writer.
- [ ] Routes per the table above, reading Connection state from `GET /connections`.
- [ ] `not_connected` renders with a connect action, not as plain text.
- [ ] `app_not_installed` renders the owner's name and the install link.
- [ ] `connection_expired` says reconnect, and offers it.
- [ ] A GitLab URL for a public project imports through the anonymous client-side path.
- [ ] A URL that is neither provider's shape is rejected immediately, before any request, with a
      message naming what was expected.
- [ ] Once files are in hand, everything downstream is unchanged: same validation, same Artifact
      build, same `PUT`, same presigned upload, same replacement of an existing Skill of the same
      name.

## Testing

No web seam, per the precedent in `.scratch/skill-analytics/spec.md`: these are glue over a contract
tickets 01, 02, and 04 already prove, and the repo has no browser harness. Verify in the browser
before marking this ready for review.

## Blocked by

- 01 — Integration table and Admin configuration
- 02 — Connections and the connect flow
- 04 — Import route, running on Connections

---
GitHub: #37
Spec: `.scratch/github-import/spec.md`
ADR: `docs/adr/0024-import-is-a-github-app-and-login-stays-an-oauth-app.md`
