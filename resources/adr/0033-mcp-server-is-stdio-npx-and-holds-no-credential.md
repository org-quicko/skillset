# The MCP Server Is Stdio, Distributed by `npx`, and Holds No Credential

A new workspace, `@in-org-quicko/skillset-mcp`, serves the Registry over the Model Context Protocol so a coding
Agent can search for a Skill without its User running `skillset` or a terminal at all. It runs over
**stdio**, on the User's own machine, fetched fresh by `npx` on every cold start rather than
installed — and it carries **no credential of any kind**: no `--token` flag, no `SKILLSET_TOKEN`, no
read of the CLI's stored config, and no `authorization` header on any request it sends. This ticket
builds only `search_skills`; `install_skills` and Agent detection are future work the shape already
anticipates (`.scratch/mcp-server/spec.md`).

## Considered Options

**A remote HTTP server**, run once by a maintainer and pointed at by every Agent. Rejected for this
feature even though `search_skills` alone would work fine over it: `discourse-mcp` — the shape this
follows — offers stdio for exactly this reason, and the spec's `install_skills` needs a process running
on the User's own filesystem to install into. Building `search_skills` on a transport `install_skills`
cannot reuse would mean rewriting the transport under it the moment the next ticket lands. stdio
costs nothing today and is the only choice that still works once installing exists.

**A `skillset` subcommand**, e.g. `skillset mcp`. Rejected: `npx` would fetch the whole CLI — its
prompt library, its argument parser, its colour library — to run a server with no terminal attached,
on every cold start. A separate package keeps the dependency set to the MCP SDK, `zod`, and
`@in-org-quicko/skillset-shared`.

**Installed once, rather than fetched by `npx` each run.** Rejected as the thing that makes this
usable by the non-technical User the feature exists for: an install step is exactly the friction
`npx -y @in-org-quicko/skillset-mcp@latest` removes. It also means every session runs a current version without
anyone managing an upgrade.

**A `--token` flag with reads used to be authenticated, and it turns out this deployment needs
one.** Considered and rejected outright rather than deferred. Reads are open (ADR-0013), so a Token
would buy nothing today, and holding one is not free: it would make this the first component in the
Registry capable of acting *as* a User, and it would do so unattended, inside a process a person
configured once in their Agent's settings and then forgot about. A Registry that gates reads simply
cannot be used with this server — `skillset install` remains the path for that deployment. Introducing a
credential later is a decision about how it is obtained, stored, and scoped, and is its own spec.

## Consequences

**Hand-rolled flag parsing, not the CLI's `commander`/`@clack/prompts`/`picocolors`.** Dragging the
CLI's argument-parsing and prompt libraries into a package meant to be re-fetched by `npx` on every
invocation would defeat the reason this is a separate workspace. `--registry`, `--scope`, and
`--log-level` are parsed by hand in `src/config.ts`.

**`--registry` is required, with no default.** A Registry is self-hosted, so there is no address to
guess, and reading from the wrong one silently is worse than refusing. Its absence is an error naming
both the flag and `SKILLSET_REGISTRY`; the flag wins when both are given.

**`--log-level` writes only to `process.stderr`.** stdout carries the JSON-RPC stream the client
reads; anything this server writes there would corrupt the protocol. There is no equivalent risk on
stderr, so diagnostics go there unconditionally.

**The tool handler is a plain function taking an injected `fetch`.** `searchSkills(fetchImpl,
registryUrl, params)` does the one HTTP call and the response mapping, with no dependency on an
`McpServer` or a transport. `src/server.ts` is a thin registration around it — not itself
unit-tested at the same rigor — which is what lets `search-skills.test.ts` assert on requests and
results without standing up an MCP client, the same seam the CLI's commands already use
(`apps/cli/src/http.ts`, `apps/cli/test/helpers.ts`'s `stubFetch`).

**No tool writes to the Registry, under any flag.** The equivalent of `discourse-mcp`'s
`--allow_writes` gate here is simply not building a write tool. Publishing and deleting need a Token
and a role; keeping this server read-only is what lets it be configured with a URL and nothing else.

**`search_skills` is a projection of the existing catalog listing**, filtered to the `skill` Kind
and passing `q`, `tag_id`, and `page_size` through to `GET /resources` — no new read path, and no new
schema: it reuses `@in-org-quicko/skillset-shared`'s `SkillDirectoryPageSchema`, the same shape `GET /resources`
already returns.
