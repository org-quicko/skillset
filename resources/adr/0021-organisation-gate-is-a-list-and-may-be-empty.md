# The Organisation Gate Is A List, And May Be Empty

A Provider admits a login if the organisation it asserts is **any one of** several
`permitted_organisations`, and an operator may leave that list empty, which turns the check off
entirely.

This changes two things ADR-0015 and ADR-0018 were emphatic about. The gate was one organisation,
and it was mandatory: ADR-0018 called it "not defence in depth — it is the door", and a check
constraint made an enabled Provider without one impossible. Both of those are now gone.

## Considered Options

**Leaving it as one mandatory organisation.** This is the safer design and it is not close. It is
rejected because it does not fit deployments the Registry is actually for: a company with two
Workspace domains after an acquisition, or Skills split across `acme` and `acme-labs` on GitHub,
could configure exactly one and had no way to say so. That is a real need, and a list satisfies it
without weakening anything — a login still has to match something.

**A list, but still at least one entry.** This keeps the door shut and solves the multi-organisation
case, and it was the option to beat. It was rejected on the operator's own judgement rather than on
merit: an internal Registry behind a VPN, or one where the GitHub organisation *is* the company and
membership is not in question, does not need the Registry re-checking what the network already
decided. Refusing to express that forces the workaround — inventing an organisation, or handing out
passwords — and a workaround is worse than a configuration, because it is invisible.

**Per-Provider "allow anyone" as a separate flag**, keeping the list non-empty. Rejected as the same
state with two spellings: a flag on with a list set is ambiguous about which wins, and every reader
has to learn the precedence. An empty list has exactly one meaning.

## What an empty list means

Every account the provider will authenticate gets a `reader` on this Registry. For Google and
Microsoft that is any account those providers hold, personal ones included. For GitHub it is the
whole internet: anyone can create an account in under a minute.

Nothing else changes. A created User is still a `reader`, roles are still never taken from a
Provider, and the Superadmin is still the only way to promote anyone (ADR-0015). Emptying the list
does not widen what a stranger can *do* — it widens who can get in the door and read.

The `identity_providers_enabled_requires_organisation` check constraint is dropped. It existed to
make this state unreachable, so it cannot survive a decision to allow it.

## How it is kept from happening by accident

The refused design here was the quiet one. An empty gate is easy to reach by clearing a field and
easy not to notice afterwards, so the whole cost of this decision lands on whether an operator
*knows* it is on:

- The configuration form shows a destructive-styled warning the moment the field parses empty,
  naming the provider and what it now admits.
- The Providers table shows **Anyone — no check** in destructive styling for an enabled ungated
  Provider, rather than a blank cell that looks half-configured.
- Saving one enabled and ungated logs a warning naming the Provider.
- **Every login through it logs a warning.** Not the first, every one — a single line at
  configuration time scrolls away, and the thing an operator needs when reading logs six months
  later is evidence in the moment an account was created.

The gate remains read per login (ADR-0019), so emptying or refilling the list takes effect on the
very next attempt.

## Refusals now say which check failed

ADR-0015 had every refused login return one opaque code, so an attacker could not learn which check
they tripped. That is abandoned for a specific reason: it was costing far more than it bought.

The case that forced it is the one ADR-0018 warned about. An organisation with third-party
application restrictions returns *no organisations at all* from `/user/orgs` until an owner approves
the OAuth app — so every member is refused, and the coarse message was identical to the one a
genuine outsider got. An operator seeing it has no way to tell "approve the app" from "this person
does not belong here", and the ADR's own prediction — that someone would lose an afternoon to it —
is exactly what happened.

The codes now distinguish an unapproved OAuth app, non-membership, a disabled Provider, an
unconfigured kind, and a provider that supplied no email. What they still never carry is *which*
organisations would have passed: which check failed is public, what would satisfy it is not. That
is the half of the original reasoning worth keeping.

## Consequences

**The Registry can be configured to admit anyone, and that is now a supported state rather than a
bug.** Every warning above is mitigation, not prevention. An operator who empties the list and
ignores four warnings has an open Registry, and the ADR trail says they chose it.

**Microsoft cannot express a list in its endpoint.** Its tenant is part of the authorize URL, not
only a claim. One permitted tenant still pins the endpoint to it; several fall back to the
multi-tenant `organizations` endpoint and lean on the per-login `tid` check, which runs either way.
The gate is unchanged in strength — a non-permitted tenant is still refused — but each tenant now
consents to the app separately.

**`permitted_organisation` becomes `permitted_organisations`, a `text[]`.** The migration carries
the existing value into a one-element array rather than dropping the column, because an operator who
had a gate must not silently end up without one — which is precisely what this ADR makes possible
and therefore precisely what the migration must not do by itself.

**Matching is case-insensitive on both sides, and any single match admits.** Stored spellings are
kept as the Admin typed them; comparison is lowercased. Duplicates differing only in case are
collapsed on write.
