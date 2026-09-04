# A Kind May Have No Artifact

An MCP Server has no Artifact. Its entire payload is a `server.json`-shaped record pointing at
where the server actually comes from — an npm, PyPI, OCI, NuGet, Cargo or MCPB identifier under
`packages[]`, or a URL under `remotes[]` — so there are no bytes for the Registry to hold. A
Resource's Artifact is therefore a property of its Kind: Skill and Plugin have one, MCP Server
does not. Publishing is two-phase for the Kinds that have bytes and one request for the Kind that
does not, and `PUT /resources/{kind}/{name}` returns a `z.discriminatedUnion("kind", …)` — 
`{ resource, upload }` for a bundle Kind, `{ resource }` for an MCP Server.

## Considered Options

**Synthesising an Artifact for an MCP Server** — a zip containing its `server.json`, so the
pipeline stays uniform. Rejected as a lie that costs real confusion later: it would give the
Resource a download nobody should use, an install count measuring nothing, and a presigned upload
for a file the client already sent as JSON. The public MCP registry describes itself as "the
official centralized metadata repository" and stores no archives; even its one bundle type
(`mcpb`) is a pointer — a release URL plus a required `fileSha256`.

**Reversing ADR-0001 so no Kind has bytes at all**, storing every Resource as metadata and
letting Skills point at a git ref. Rejected: it throws away the working half of the design to
make the new half symmetric, and it would make the Registry a link farm rather than a place a
Skill actually lives.

**A nullable `upload` field on one flat response shape.** Simpler by a few lines, and it was
close. Rejected because it forces every caller to null-check a field that can never be null for
a Skill, and the two-phase publish is a genuine property of "has an Artifact" that a
discriminated union states and a nullable field only implies.

**Two separate publish routes**, one per phase-count. Rejected: it splits the upsert-by-name
semantics, the role check, and the publisher attribution across two handlers that agree on
everything except one response field.

## Consequences

**Publish and install do not generalise. Storage and discovery do.** That is the honest
boundary of this whole redesign, and it should be stated wherever someone might expect
otherwise: one catalog, one Tag catalog, one search, one directory view, one `resources`
table — but a per-Kind publish contract and a per-Kind install action.

`GET /resources/{id}/artifact` is a 404 for an MCP Server, not an empty 200. There is no
Artifact, so there is nothing to represent.

The web publish surface splits by Kind. A Skill or a Plugin is a folder the browser reads and
zips; an MCP Server is a `server.json` a writer pastes or drops, validated client-side by the
shared schema and previewed before publish. That is the same division of labour ADR-0001 already
chose — the client posts a claim, the server validates it against the shared schema — applied to
a payload that happens to have no bytes beside it.

ADR-0001 is unchanged and, if anything, reinforced: the Registry inspects no Artifact, and now
some Resources have none to inspect. The `fileSha256` an MCPB package carries is a value the
*publisher* asserts inside the payload, not a digest the Registry computed — the Registry still
has nothing truthful of its own to record about bytes.
