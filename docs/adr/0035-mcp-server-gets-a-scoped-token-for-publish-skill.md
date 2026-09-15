# The MCP Server Gets an Optional Token, Scoped to `publish_skill`

`publish_skill` lets an Agent publish a Skill from the current project straight to the Registry,
the missing counterpart to `search_skills` and `add_skills` (spec, "Publishing"). Publishing needs a
writer Token (ADR-0009 requires the same compliant frontmatter this checks locally; the Registry's
role check is what a Token stands in for). This reopens ADR-0033's "holds no credential of any
kind" — deliberately, and only for this one tool.

## Why reopen it

ADR-0033 rejected a `--token` flag outright, not merely deferred it, on the reasoning that reads
need no authentication (ADR-0013) so a Token would buy nothing, and holding one turns the server
into something that can act *as* a User, unattended. Both points still hold for `search_skills` and
`add_skills` — neither changes here. What has changed is that a third tool now exists whose entire
purpose is a write the Registry will not perform without a Token: there is no read-only way to
publish. Deferring credential support forever would mean `publish_skill` simply could not exist,
which is a heavier cost than the one ADR-0033 weighed against it.

## Considered options

**Keep the server credential-less; make `publish_skill` validate locally and stop.** Considered
first, since it needs no ADR change at all — the tool would run the same local checks
`buildSkillBundle` already runs and report the Skill ready to publish, leaving the actual `PUT` to
`sqillset publish`. Rejected: it does not do what the name promises, and it recreates the exact
inconvenience the whole server exists to remove — needing a terminal for the one Skill a User just
finished writing, right after using the credential-less half of this same server to find and add
every other one.

**Read the CLI's stored config (`~/.sqillset/config.json`)**, so publishing needs no configuration
of its own. Rejected for the reason ADR-0033 already gave it by name: a process an Agent launches
unattended silently gaining whatever role the User's own logged-in session has is a larger blast
radius than a Token scoped to this one server, and ties this workspace's configuration to the CLI's
storage format for the first time.

**An OAuth/device-code handshake at first use.** The right shape eventually for a User who has
never touched a terminal, but real scope: a browser round-trip, token storage, and refresh, none of
which exists anywhere in this codebase yet. Deferred rather than built speculatively for a first
version of one tool.

## Decision

`--token` / `SQILLSET_TOKEN` are read, the same way `--registry` / `SQILLSET_REGISTRY` already are
— `--token` wins when both are given. The Token is carried on `McpConfig` but reaches the network on
exactly one path: the `authorization: Bearer` header `publish_skill` sends. `search_skills` and
`add_skills` are unchanged — they still send no such header on any request, so a User who never
configures a Token loses nothing they had before.

`publish_skill` checks `config.token` itself before doing any work and refuses immediately, naming
the missing flag/variable, rather than letting the Registry's own 401 explain it after a build and a
validation pass — the same "no Skill found" shape ADR-0033's sibling ticket already used for the
absent case.

Publishing an existing name overwrites it completely (ADR-0002); there is no separate confirmation
step here the way `sqillset publish` has for a multi-Skill directory, because this tool takes one
directory and publishes exactly the Skill at it — no discovery walk, no batch.

## Consequences

**`McpConfig.token` is `string | undefined`**, alongside `agentId`'s existing optional-override
shape — present as a field on every config, absent unless configured.

**`--token`'s absence is not a startup error.** Unlike `--registry`, a Token is optional at the
process level: `search_skills` and `add_skills` still work with none configured. The refusal lives
in `publish_skill`'s handler, checked on the first call to that tool rather than at connection time.

**`packages/shared`'s existing `ApiError`/`apiErrorFrom`/`parseApiResponse` are reused as-is**, the
same decoding the CLI and the web interface already share — nothing new was added to `shared` for
this. The local file-walk (`walkSkillDirectory`/`holdsSkillFile`) is small enough, and specific
enough to a filesystem the CLI also happens to run on, that it is duplicated in `apps/mcp` rather
than extracted — matching the CLI's own copy in shape, not by import.

**No batch discovery.** `apps/cli/src/commands/publish.ts` can be pointed at a directory holding
several Skills and publishes all of them. `publish_skill` only publishes the one Skill at `path`
(defaulting to the project root), erring by name when that directory holds no `SKILL.md` — an Agent
calling this tool already knows which Skill it just wrote.
