# The Registry Serves a Plugin Marketplace

The Registry serves a `.claude-plugin/marketplace.json` so an off-the-shelf agent can install
from it natively, without `skillreg`. Skills and Plugins are projected as plugin entries with
`archive` sources pointing at their Artifacts; MCP Servers are not listed. Reads stay
token-gated: a `url`-source marketplace supports `headers` and `headersHelper`, and
`headersHelper` runs before every `marketplace.json` fetch and every same-origin archive
download, so the Registry's own auth survives.

> **Supersedes ADR-0003.** That ADR declined to serve a discovery document, and its reasoning was
> sound for the protocol it examined: `npx skills add <url>` sends `Authorization: Bearer` only on
> GitHub API calls, so serving an agent-skills index would have published every Skill to anyone
> who could reach the host. **That premise does not hold for Claude Code marketplaces**, which
> support per-fetch headers. ADR-0003 also anticipated its own reversal — "deferred rather than
> rejected on principle… roughly an afternoon" — while assuming a trusted network perimeter would
> be the thing that unlocked it. It turns out a header helper is enough. The agent-skills
> discovery protocol itself is still not served, for ADR-0003's unchanged reason.

## Considered Options

**Listing Plugins only.** The literal reading, and the smaller one. Rejected because a Skill
projected as a single-plugin entry is nearly free — the zip and the presigned URL already
exist — and it is what makes the whole catalog installable by an agent nobody had to install
`skillreg` for. Restricting the projection to Plugins would leave the Registry's largest Kind
reachable only through our own client, which is the exact cost ADR-0003 recorded and wanted back.

**Listing all three Kinds, synthesising a bundle for MCP Servers.** Rejected: it reverses ADR-0027
the moment it ships. An MCP Server has no bytes by decision, and a zip built solely to satisfy an
`archive` source is the "uniform pipeline" ADR-0027 declined. Note honestly that this is **not**
because MCP Servers reach users some other way — whether a marketplace entry can carry inline MCP
server configuration is unverified, and `plugin.json`'s `mcpServers` field is a *path override*
inside a bundle, not inline config. The gap is real and accepted, not explained away.

**Serving it unauthenticated.** Rejected for ADR-0003's original reason, undiluted: it would
publish every Resource to anyone who can reach the host.

## Consequences

**`archive` entries carry no `sha256`, and consumers therefore get no integrity check.** The field
is optional, and ADR-0001 is why it has to be omitted: "there is no size or digest column: the API
never sees the bytes, so it has nothing truthful to record." Publishing a digest would mean either
reading the Artifact — the decision ADR-0001 exists to avoid — or repeating a number the publisher
asserted, which is worse than none. Anyone who needs verified bytes needs ADR-0001 reopened first.

**Consumers need a settings entry, not just a command.** There is no documented flag on
`claude plugin marketplace add` for passing headers; a header-authenticated marketplace is
declared in the consumer's settings (`extraKnownMarketplaces`, with `headers` or `headersHelper`).
So installation is a documented per-machine setup step, not a one-line copy-paste, and the
Registry should ship that snippet in its interface. Headers are also dropped on cross-origin
redirects and on non-`https://` URLs — a Registry reached over plain HTTP silently loses its auth
on these fetches, which makes TLS a requirement for this endpoint rather than a recommendation.

The projection is a read model over `resources`, in the spirit of ADR-0003's own note that a
discovery document is "a projection of the `skills` table". Marketplace entries carry `category`
and `tags`, so the Tag catalog (ADR-0011) has somewhere real to land; `plugin.json` carries
`keywords` for the same purpose inside a bundle.

This endpoint is a **third consumption path**, alongside the web Download and `skillset install`. Each
one that arrives has to decide what it records as an Install (ADR-0028). A marketplace archive
download is a Download of the Artifact and counts as one, the same as the web path — with the
caveat that background marketplace auto-updates may fetch without a human asking, which is a
source of counts the other two paths do not have.
