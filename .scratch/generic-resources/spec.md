# Generic Resources

Make the Registry hold **Resources** of several **Kinds** — `skill`, `mcp-server`, `plugin` —
rather than Skills alone.

Terms are as defined in [CONTEXT.md](../../CONTEXT.md). Decisions are recorded in
[ADR-0026](../../docs/adr/0026-resource-with-a-kind-and-a-payload.md),
[ADR-0027](../../docs/adr/0027-a-kind-may-have-no-artifact.md),
[ADR-0028](../../docs/adr/0028-install-is-per-kind-and-counts-are-not-comparable.md),
[ADR-0029](../../docs/adr/0029-add-merges-an-existing-mcp-json.md) and
[ADR-0030](../../docs/adr/0030-registry-serves-a-plugin-marketplace.md); this spec is the
implementation shape those decisions imply. [docs/data-model.md](../../docs/data-model.md)
describes the schema as it **is** and is updated as each ticket lands — the schema below is the
target.

Nothing is deployed: versions are `0.0.0`, the root package is private, and `@skill-registry/cli`
is unpublished. So routes, table names, and storage keys move freely, with no compatibility
window, no aliases, and no dual-write period.

## What generalises, and what does not

One catalog, one Tag catalog, one search, one directory view, one `resources` table. **Publish
and install stay per-Kind** (ADR-0027) — that is the boundary, and it is deliberate.

| Concern | Generic | Per-Kind |
| --- | --- | --- |
| Identity, description, publisher, timestamps, `body` | ✔ | |
| Tags, search, listing, filtering, sorting, stats | ✔ | |
| Install event log and analytics | ✔ (one log) | what an Install *is* (ADR-0028) |
| Roles and auth | ✔ | |
| `name` / `description` validation rules | | ✔ |
| Payload shape | | ✔ (`jsonb`, ADR-0026) |
| Artifact | | ✔ (Skill, Plugin only — ADR-0027) |
| Publish contract | | ✔ (two-phase, or one request) |
| `add` behaviour | | ✔ (`.agents/skills`, or `.mcp.json` — ADR-0029) |
| Import | | ✔ (Skill, Plugin only) |
| Marketplace projection | | ✔ (Skill, Plugin only — ADR-0030) |

## Kinds

`kind` is plain text, validated in the service against a `KINDS` map in
`@skill-registry/shared` — the treatment `integrations.provider` already gets against
`GIT_PROVIDERS` (ADR-0024). A fourth Kind is an insert, not a migration.

| | `skill` | `mcp-server` | `plugin` |
| --- | --- | --- | --- |
| `name` rule | 1–64, lowercase alnum + hyphen | reverse-DNS, one slash, 3–200, dots and uppercase allowed | kebab-case |
| `description` max | 1024 | **100** | 1024 |
| Artifact | zip | **none** | zip |
| Payload | `license`, `compatibility`, `metadata`, `allowed_tools` | `packages[]`, `remotes[]` | manifest scalars |
| `body` source | `SKILL.md` below the frontmatter | author-written | author-written |
| Publish | two-phase | one request | two-phase |
| `add` | `.agents/skills/<name>` + symlink | merge project `.mcp.json` | `.agents/skills/<name>` |
| Import | ✔ | ✘ | ✔ |
| Marketplace | ✔ | ✘ | ✔ |

The upstream MCP `name` pattern is `^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$`, and `description` is
capped at 100 characters — both fixed by the specification, and both incompatible with the
current shared rules, which is why the rules become per-Kind rather than one relaxed superset.

## Target schema

`resources`, replacing `skills`:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | pk, default `uuidv7()`; keys the Artifact in storage (ADR-0026) |
| `kind` | `text` | not null, validated in the service against `KINDS` |
| `name` | `text` | not null; **unique on `(kind, name)`** |
| `description` | `text` | not null; max length is per-Kind, enforced in shared, not by a check constraint |
| `body` | `text` | **nullable** — markdown documentation, a Skill's `SKILL.md` body or author-written |
| `payload` | `jsonb` | not null; the Kind's own fields, validated by a discriminated union |
| `published_by` | `uuid` | null, `references users(id) on delete set null` |
| `published_by_email` | `text` | not null, snapshot |
| `published_by_name` | `text` | not null, snapshot |
| `published_at` | `timestamptz` | not null |
| `created_at` / `updated_at` | `timestamptz` | not null |
| `search` | `tsvector` | generated, over `name`, `description`, `published_by_name` |

The `skills.name` check constraint is **dropped**: no single pattern fits three Kinds, so
validation lives entirely in the shared per-Kind validators. The database keeps the
`(kind, name)` unique index, the GIN index on `search`, and an index on `updated_at` descending
for the new default sort.

Renamed, otherwise unchanged: `skill_tags` → `resource_tags` (`resource_id`, `tag_id`),
`skill_install_events` → `resource_install_events`, `skill_analytics` → `resource_analytics`,
`skill_directory` → `resource_directory` (plus a `kind` column, for the catalog's Kind filter).

`tags` is untouched — one catalog, now shared across Kinds (ADR-0026, amending ADR-0008 and
ADR-0011).

## API

One router. `kind` appears in every write path, because `name` alone no longer identifies a
Resource.

```
GET    /resources                        catalog; ?kind=, ?tag_id=, ?q=, ?sort_by=, ?sort_order=, ?page=, ?page_size=
GET    /resources/stats                  registered before /resources/:id, as /skills/stats already is
GET    /resources/:id
GET    /resources/:kind/by-name/:name
PUT    /resources/:kind/:name            writer; upsert by (kind, name)
DELETE /resources/:id                    admin
PUT    /resources/:id/tags               writer; full replace
GET    /resources/:id/artifact           302, or JSON with Accept: application/json; 404 for mcp-server
```

`sort_by` defaults to **`updated_at`**, not `installs` (ADR-0028). `installs` remains an accepted
value.

`PUT /resources/:kind/:name` returns a `z.discriminatedUnion("kind", …)`:

- `skill`, `plugin` → `{ resource, upload }`, `upload` being the presigned `PUT` target
- `mcp-server` → `{ resource }`, publish complete in one request

A `POST /resources/:id/installs` records the Install for a Kind with no byte transfer — called
when the web interface reveals an MCP Server's config (ADR-0028). Best-effort, like the existing
`recordInstall`: a failure is logged and swallowed. This is the first path a client can drive
directly, so it is rate-limited and its count is treated as softer evidence than a download.

## Shared package

`ResourceSchema` is the core, and each Kind contributes a payload schema, combined into
`ResourcePayloadSchema = z.discriminatedUnion("kind", [...])`. `KINDS` maps each Kind to its
name validator, description limit, whether it has an Artifact, and its payload schema — one
place a fourth Kind is registered.

`frontmatter.ts` stays as it is: it parses `SKILL.md` into a Skill's payload and body, and it is
Skill-specific by nature. `skill-rules.ts` splits into shared helpers plus per-Kind rules. A new
`mcp-server.ts` carries the `server.json` schema. `agents/table.ts` is unchanged and is now
documented as Skill-only.

## CLI

`skillreg publish` detects the Kind from what it is pointed at — a directory with a `SKILL.md`,
a `server.json`, or a directory with `.claude-plugin/plugin.json` — and `--kind` overrides.

`skillreg add` dispatches on the Resource's Kind:

- `skill`, `plugin` — unchanged: `.agents/skills/<name>`, symlink or copy into the chosen
  Agent's directory (ADR-0022).
- `mcp-server` — merge one entry under `mcpServers` in the project's `.mcp.json`, no Agent
  prompt, project Scope only. Refuse rather than overwrite an unparseable file; replace an
  existing entry of the same name only on confirmation or `--force`; preserve surrounding
  formatting as far as is practical; print the snippet to paste wherever the write cannot
  happen (ADR-0029).

The merge is the first time `add` writes into a file the developer already owns, and those
protections are load-bearing rather than defensive polish — see ADR-0029's consequences.

## Web

One catalog with a Kind filter beside the existing Tag filter. One detail page shape, rendering
`body` as markdown for every Kind — which is why `body` is core and nullable rather than
Skill-only.

Publish splits by Kind: a folder picker that reads and zips for Skill and Plugin (as today), and
for MCP Server a paste-or-drop of `server.json`, validated client-side by the shared schema and
previewed before publish. No nested form is built for `packages[]`, `remotes[]` or
`KeyValueInput` — the author already has the file (ADR-0027).

An MCP Server's page shows its structured config with a reveal-and-copy action, which is what
records its Install.

## Out of scope

- Marketplace projection of MCP Servers. It would require synthesising bytes, reversing ADR-0027.
  Whether a marketplace entry can carry inline MCP config is **unverified** — do not treat that
  as the reason.
- Marker-file Kind detection on Import (`SKILL.md` / `server.json` / `plugin.json` in an
  arbitrary repo folder). Import generalises to Plugin only for now; a Plugin *is* a repository,
  so Import is its natural publish path, while an MCP Server is thirty lines of JSON.
- The agent-skills discovery protocol (ADR-0003's subject, still declined).
- Any digest or size recorded for an Artifact — ADR-0001 stands, which is why marketplace
  `archive` entries carry no `sha256` (ADR-0030).
- Renaming the repository, the `@skill-registry/*` packages, or the `skillreg` binary. Churn
  against nothing published.

## Tickets

In dependency order. Ticket 1 touches every file and lands with the product **unchanged**, which
is the property that makes it reviewable.

1. **`resources` table and the shared Kind model.** Migration renaming `skills` and its
   satellites, `payload jsonb`, `(kind, name)` unique, check constraint dropped, `KINDS` and the
   discriminated union in shared. `skill` is the only registered Kind. No route, CLI, or web
   change beyond following the types.
2. **Routes and storage keys.** `/skills/*` → `/resources/*`, `kind` in write paths, Artifact
   keyed on `id`, default sort `updated_at`, `kind` on `resource_directory` (unfiltered until
   ticket 3 gives it something to filter).
3. **MCP Server as a second Kind.** `server.json` schema, per-Kind name and description rules,
   the discriminated publish response, `POST /resources/:id/installs`, web paste-and-preview
   publish, detail page with reveal-and-copy, Kind filter live in the catalog.
4. **`add` merges `.mcp.json`.** Kind dispatch in `add`, the merge with all of ADR-0029's
   refusals, snippet fallback, `--scope user` error.
5. **Plugin as a third Kind.** Manifest payload, publish, and Import generalised from a Skill
   folder to a Plugin repository.
6. **The marketplace endpoint.** `.claude-plugin/marketplace.json` projected from `resources`,
   Skills and Plugins as `archive` entries, token-gated via `headersHelper`, with the consumer
   settings snippet shown in the interface.
