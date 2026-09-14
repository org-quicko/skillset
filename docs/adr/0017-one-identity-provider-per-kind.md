# One Identity Provider Per Kind

A Provider is keyed by its kind: exactly one Google, one Microsoft, one GitHub, each either enabled
or not. This reverses ADR-0015's slug-keyed table, which permitted several Providers of the same
kind, and the immutable `slug` column goes with it.

## Considered Options

**Keeping the slug-keyed table**, where a deployment could configure two Google Providers against
different Workspace domains. Rejected because Better Auth's `socialProviders` is an object keyed by
provider name with one configuration per key (ADR-0016), so preserving the capability means either
the `genericOAuth` plugin — giving up the built-in handling of GitHub that ADR-0018 depends on — or
running several Better Auth instances, which is a great deal of machinery for a capability nothing
asked for. CONTEXT.md describes a Registry as serving one team, and one team has one Workspace
domain, one Entra tenant, and one GitHub organisation.

**Keeping the slug column as a display key** while making `kind` unique. Rejected as the worst of
both: a column that looks like an identifier, is not one, and has to be explained everywhere it
appears.

## Consequences

**A deployment spanning two Workspace domains cannot be expressed.** This is a real reduction
against what shipped, not a tidying-up, and it is the reason this is an ADR rather than a line in
the spec. The escape hatch, if it is ever needed, is that a Provider's organisation gate can hold a
list rather than a single value — one Google Provider admitting two `hd` values is a much smaller
change than restoring several Providers per kind, and covers the case that would actually arise.

**ADR-0015's `state` machinery disappears.** The slug travelled in `state` so the callback could
tell which Provider a response belonged to, and the nonce cookie was bound to that slug so a flow
begun against one Provider could not be completed against another. With one Provider per kind and
Better Auth's per-kind callback path (ADR-0016), the provider is in the path and the binding is
Better Auth's to enforce. `auth/oidc-state.ts` goes.

**The login page keys its buttons by kind**, which is also what decides each button's label and
icon. `display_name` stays, because an operator may reasonably want the button to read "Acme SSO"
rather than "Google".
