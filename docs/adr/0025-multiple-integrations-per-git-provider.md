# Multiple Integrations Per Git Provider

ADR-0024 made `integrations.provider` the table's primary key: at most one Integration per Git
Provider, and its existence the only switch Importing has. That stops being true here. An operator
may now register **more than one app for the same provider** — two different GitHub Apps, say, for
two different orgs or environments — and a writer picks which one to connect through.

This supersedes the "one row per provider" half of ADR-0024. Everything else it settled —
Importing as a GitHub App, the OAuth dance, Connections living outside Better Auth, encryption at
rest, the credential layer staying GitHub-only — is untouched.

## Why

An Admin who manages Skills across more than one GitHub organisation, or wants a staging app kept
separate from production, could not register a second GitHub App at all: `POST /integrations` on an
already-configured provider was refused as `provider_taken`. The only workaround was editing the
existing row's `client_id`, which repoints every writer's Connection at the new app and forces
everyone to reconnect — not a workaround an Admin managing two live orgs can use.

## The change

`integrations` gets a surrogate `id` (uuid) as its primary key; `provider` becomes a plain,
non-unique column. `connections` gains `integration_id` (uuid, `references integrations.id`,
`ON DELETE RESTRICT`), recording which app a writer's grant was actually issued through —
`connections.provider` stays, denormalized, so every provider-keyed read path (`accessTokenFor`,
`disconnect`, imports) is unaffected. The uniqueness rule on `connections` stays
`(user_id, provider)`: a writer holds **one active Connection per provider at a time**, and
connecting through a different app for the same provider replaces it, exactly like today's reconnect.
A single writer holding simultaneous, independent tokens from two apps for the same provider was
considered and rejected — nothing asked for it, and it reopens "which of several tokens does an
Import use", a question this Registry does not need to answer.

The OAuth `state` payload already carried `{p, u, n, e}` (provider, user, nonce, expiry); it gains
`i`, the chosen Integration's id. `start` resolves and signs it in; `complete` reads it back out of
the verified state, so the callback route needs no new parameter — only `/connections/:provider/start`
gains an optional `integration_id` query param.

**When a provider has more than one Integration and none is named**, `start` refuses with a new
`integration_choice_required` (400) rather than guessing. The interface never triggers this refusal
in practice: `GET /connections` now returns one `connectable` entry per Integration, not per provider,
so the writer always names one explicitly. A provider with exactly one Integration configured needs
no `integration_id` at all — there is nothing to choose, and every existing single-app deployment
keeps working unchanged.

An import's `AppNotInstalledError` install-link hint now comes from the writer's *own* connected app
(`connections.integrationFor`), not an arbitrary Integration configured for the provider — a sibling
app for the same provider may carry a different `app_slug`, and pointing at the wrong one would send
a writer to install the wrong app.

## Consequences

`PATCH /integrations/:provider` becomes `PATCH /integrations/:id` — an Integration's `provider` was
never editable and still is not, but `id` is now what a request must name. `POST /integrations` no
longer refuses a second row for an already-configured provider; `IntegrationProviderTakenError` is
removed, since there is no longer a constraint for it to report a violation of.

Repointing an Integration's `client_id` (still the way to rotate to a different app in place) now
clears only the Connections made through **that specific Integration**, not every Connection for its
provider — a correctness improvement the surrogate key gives for free, since a sibling app's
Connections were never affected by this app's credentials changing.

The app is still under development, so the migration does not attempt to backfill `integration_id`
for existing Connections — it clears the `connections` table outright and writers reconnect, picking
an app from the list. A production migration performed after this ADR would need to decide how to
backfill instead (most naturally: assign the sole Integration each provider had at the time).
