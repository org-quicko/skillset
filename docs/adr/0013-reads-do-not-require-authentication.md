# Reads Do Not Require Authentication

Listing, searching, viewing a Skill's `SKILL.md`, and downloading its Artifact no longer
require a session or Token — anyone who can reach the Registry's URL can perform them.
Publishing, deleting, and User/Admin management remain role-gated exactly as before. This
narrows what "closed by default" (spec) and ADR-0005's per-request role resolution mean:
they now describe writes and administration only. The Registry's confidentiality boundary
for reads is the operator's network, not application-level auth.

## Considered Options

- **Keep every request behind Token/session auth** (status quo, ADR-0005): rejected — the
  team wants zero-friction browsing, search, and CLI reads with no Token to mint first,
  closer to how the public GitHub-indexed alternatives feel for readers.
- **Public reads via an auto-issued read-only Token**: rejected as unneeded complexity —
  there is no per-Skill visibility to gate (out of scope, spec), so a blanket-public GET
  has the same effect with none of the bookkeeping.

## Consequences

- The `reader` role no longer grants anything an anonymous visitor doesn't already have;
  it survives only as the default/lowest tier for provisioning a User ahead of promotion
  to writer.
- Anyone who can reach the Registry's network address can enumerate and download every
  Skill. A deployment that needs reads to stay private must restrict network access
  itself (VPN, reverse-proxy auth) — the application no longer does.
