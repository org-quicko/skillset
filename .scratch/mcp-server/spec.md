# Skill Registry MCP Server

Serve the Registry over the Model Context Protocol, so a coding Agent can search for a Skill and
install it without its User running `skillset` — or a terminal at all.

Terms are as defined in [CONTEXT.md](../../CONTEXT.md). The decisions this spec builds on are
[ADR-0001](../../docs/adr/0001-registry-does-not-inspect-artifacts.md),
[ADR-0013](../../docs/adr/0013-reads-do-not-require-authentication.md),
[ADR-0022](../../docs/adr/0022-add-writes-canonical-and-symlinks.md),
[ADR-0026](../../docs/adr/0026-resource-with-a-kind-and-a-payload.md),
[ADR-0028](../../docs/adr/0028-install-is-per-kind-and-counts-are-not-comparable.md),
[ADR-0031](../../docs/adr/0031-hand-curated-agent-table-not-vendored.md) and
[ADR-0032](../../docs/adr/0032-an-artifact-is-stored-as-its-files.md).

The shape follows [`discourse/discourse-mcp`](https://github.com/discourse/discourse-mcp): a small
standalone npm package, run over stdio by the client through `npx`, configured entirely by flags in
the client's own MCP configuration, with no login step and no config file of its own.

Nothing is deployed, so tool names, flags, and the package's layout move freely. Publishing to npm
is the one genuinely new commitment; see Implementation Decisions.

## Problem Statement

A developer who wants a Skill has to leave the Agent they are working in, remember the Registry
exists, recall the Skill's exact `name`, run `skillset add`, answer two prompts, and come back. The
friction is small but it lands at the exact moment they are mid-task, and the result is that Skills
the team has already published go unused because nobody remembers to go and get them.

Someone who is not comfortable in a terminal cannot get a Skill at all. Their paths today are the
CLI — which needs a runtime, a package manager, and a `login` — or the web interface's Download
control followed by unzipping into the right directory by hand, which means knowing their Agent's
conventions.

Neither person can discover a Skill by describing what they want. Both have to already know the
`name`.

## Solution

An MCP server published as its own npm package and run over stdio by the User's Agent. Getting it
is pasting a JSON block into the Agent's MCP configuration, naming the Registry with a flag. `npx`
fetches the package on demand, so there is nothing to install, no config file to write, and no
Token to mint — reads need no authentication (ADR-0013).

It exposes two tools.

`search_skills` answers "is there a Skill for this?" against the Registry's existing full-text
search, returning each Skill's `name` and its `description` — the frontmatter description, which is
written precisely so an Agent can judge relevance.

`add_skills` installs one or more Skills into the directory the configured Agent actually reads
from. Because the server runs on the User's machine, it performs the whole install itself: resolve,
download, validate, stage, move, clean up. The User never names a path, never picks an Agent from a
list, and never sees a zip.

## Install Sequence

`add_skills` performs this per Skill, entirely within the server process:

1. Resolve the Skill by `name` against the Registry, yielding its id, `description`, and `body`.
2. Resolve the target directory from the configured Agent and Scope, and the directory name from the
   Skill's `name` through the existing sanitiser. An Agent with no skills directory at this Scope
   goes to step 8.
3. If the target already exists and overwrite was not requested, refuse — naming the Skill that is
   already there — and stop. This Skill contributes a refusal to the batch's outcomes.
4. Download the Artifact from the Registry.
5. Validate and extract it in memory, then write the files into a staging directory beside the
   target.
6. Remove the target if overwriting, then move the staging directory onto the target, and link the
   Agent's own directory to it as ADR-0022 requires.
7. Remove the staging directory, whether or not any earlier step succeeded.
8. Fallback: return the Artifact's location, the Manifest, the directory that would have been used,
   and the `SKILL.md` body.

Every step is executed and testable, which is the property the stdio choice buys and the reason it
is preferred to a remote server here.

## User Stories

1. As a non-technical User, I want to configure the Registry by pasting one JSON block, so that I
   never install a CLI, a runtime, or a package manager myself.
2. As a non-technical User, I want to need no Token or login to find and install Skills, so that
   there is nothing to set up beyond naming the Registry.
3. As a User, I want the server fetched on demand by `npx`, so that I am always running a current
   version without managing an upgrade.
4. As a developer, I want to ask my Agent whether a Skill exists for a task, so that I do not have
   to remember what the team has published.
5. As a developer, I want to search Skills by describing the problem rather than the `name`, so that
   I can find a Skill I have never seen.
6. As a developer, I want each search result to carry the Skill's `description`, so that my Agent
   can judge relevance without fetching every candidate.
7. As a developer, I want to filter a search by Tag, so that I can narrow a broad catalog.
8. As a developer, I want to cap how many results come back, so that a vague query does not fill my
   Agent's context.
9. As a developer, I want to install a Skill by naming it in conversation, so that I do not have to
   switch to a terminal mid-task.
10. As a developer, I want to install several Skills in one request, so that setting up a new project
    is one step.
11. As a developer, I want one Skill failing to install not to abandon the others in the same
    request, so that a typo in one `name` does not cost me the batch.
12. As a developer, I want the Skill written into the directory my Agent actually reads, so that I
    never have to know that directory's name.
13. As a developer, I want other Agents sharing that directory served by the same install, so that I
    do not install the same Skill twice.
14. As a developer, I want the Artifact fetched over HTTP rather than through my Agent's context, so
    that a Skill with large reference files does not consume my session.
15. As a developer, I want a hostile or malformed Artifact refused before anything is written, so
    that installing a Skill cannot write outside the directory it was meant to.
16. As a developer, I want an already-installed Skill left alone by default, so that a routine
    `add_skills` never silently discards local edits I made to it.
17. As a developer, I want to be told which Skill was already present when an install is refused, so
    that I can decide whether to overwrite it.
18. As a developer, I want an explicit overwrite to replace the installed Skill completely, so that
    no file from the previous version survives into the new one.
19. As a developer, I want a failed download to leave my skills directory exactly as it was, so that
    a dropped connection cannot produce a half-written Skill my Agent then tries to load.
20. As a developer, I want temporary files removed whether the install succeeded or failed, so that
    my project does not accumulate debris.
21. As a developer, I want the install to work when my project and my system temp directory are on
    different drives, so that the tool is not quietly broken on Windows.
22. As a developer on Windows without Developer Mode, I want the install to fall back to a copy when
    a symlink is refused, so that it succeeds rather than failing on a platform detail.
23. As a developer, I want to be told the Skill will be active in my next session rather than this
    one, so that I do not sit waiting for a Skill that has not been loaded yet.
24. As a developer, I want the `SKILL.md` body returned alongside the install, so that the current
    session can use the Skill immediately even before it is loaded properly.
25. As a developer whose Agent is not in the Registry's Agent table, I want to name my Agent
    explicitly in the configuration, so that the server still knows where to write.
26. As a developer, I want to point the server at a different Registry by changing one flag, so that
    working against a staging Registry costs nothing.
27. As a User of an Agent with no skills directory at the configured Scope, I want the Artifact's
    location and the Skill's body anyway, so that the tool is useful rather than merely refusing.
28. As a writer, I want an Install through the MCP server counted, so that my Skill's usage is not
    undercounted as adoption moves off the CLI.
29. As an Admin, I want an MCP Install distinguishable from a web Download and a CLI `add`, so that
    I can see which consumption path the team actually uses.
30. As an Admin, I want the server to expose no publish, delete, or administrative tool, so that it
    cannot change the Registry however it is configured.
31. As an Admin, I want the server to serve only the `skill` Kind, so that it cannot be mistaken for
    a way to obtain an MCP Server or a Plugin.
32. As a maintainer, I want one installer shared by the CLI and the MCP server, so that the two
    paths cannot drift into disagreeing about what installing means.
33. As a maintainer, I want the tool handlers testable without standing up an MCP client, so that
    the behaviour is covered by fast tests at a seam that already exists.

## Implementation Decisions

**The server is stdio, and distributed as its own npm package.** This is the shape `discourse-mcp`
uses and it is the right one: stdio means the server runs on the User's machine and can therefore
actually install, while `npx` means there is nothing for the User to install first. The barrier the
remote alternative was meant to remove is removed by the distribution mechanism, not by the
transport — and the transport is what makes the feature possible at all.

**It is a new workspace, not a `skillset` subcommand.** A subcommand would mean `npx` fetching the
whole CLI — its prompt library, its argument parser, its colour library — to run a server with no
terminal attached, on every cold start. A separate package keeps the dependency set to the MCP SDK
and the Registry client.

**The installer is extracted into its own node-only workspace package.** It currently lives in the
CLI, and it cannot move into `shared`, which the web interface bundles and which therefore cannot
carry filesystem code. Both `apps/cli` and the new server depend on the extracted package. This is
the change that keeps one definition of what installing a Skill means; without it the two paths
diverge on the first bug fixed in only one of them.

**Publishing to npm is a prerequisite, and is new.** Every package here is `0.0.0` and unpublished.
The paste-a-JSON-block story depends on `npx` resolving a real package from a registry, so the
release pipeline — version, scope, access, and what goes in `files` — has to exist before the
feature is usable by the User it is for. Worth sequencing first rather than discovering late.

**Configuration is flags in the client's MCP configuration, not a config file.** The Registry's URL,
the Agent, and the Scope are passed as arguments. The server reads no config file of its own and
performs no `login`; a Token may be supplied by flag or environment for parity with the CLI, but
nothing requires one because reads are open (ADR-0013).

**There is no OAuth, and this was decided rather than deferred.** Two facts settle it. MCP's
authorization specification governs HTTP transports only — it says in as many words that a stdio
implementation *should not* follow it and should take credentials from the environment instead — so
the client-driven handshake is not available to us regardless. And nothing here needs a credential:
both tools are reads (ADR-0013), and the one thing a sign-in flow would otherwise establish, which
Registry to talk to, is a setup flag. Running an OAuth flow of our own would reintroduce the
browser-and-terminal step that `npx` distribution exists to remove, in exchange for nothing this
feature does. Should a Registry deployment ever gate reads, the optional Token above is the escape
hatch; adopting OAuth would be a change to the Registry's own authentication story, not to this
server.

**No tool writes to the Registry, under any flag.** `discourse-mcp` gates mutations behind
`--allow_writes`; the equivalent here is simply not to build them. Publishing and deleting need a
Token and a role, and keeping this server read-and-install-only is what lets it be configured with a
URL and nothing else. If a write is ever wanted here, authentication comes first and is its own
spec.

**ADR-0022 is preserved, not amended.** Because the server performs the install itself, it reuses
the existing installer verbatim: files written to the canonical directory, the Agent's own directory
symlinked to it, a junction on Windows, and a copy when the platform refuses the link. Reporting
which of those happened, and which other Agents the install already serves, comes free.

**Staging is added to the shared installer, which changes `skillset add` too.** The installer today
removes the target and writes files into it directly, so a failure mid-write leaves a partial Skill.
Writing into a staging directory beside the target and moving it into place makes the install atomic
for both callers. The staging directory goes beside the target rather than in the system temp
directory: a move between filesystems is not a rename but a copy that can fail, and a project on one
drive with temp on another is the ordinary case on Windows.

**Validation happens before any byte is written.** The Artifact validator is the only place a
hostile Artifact is stopped (ADR-0001), and running it against the downloaded bytes preserves that
guarantee exactly as `skillset add` has it. This is the guarantee a remote server could not have
offered, and it is a substantial part of why stdio is the right transport.

**Overwrite is off by default, which diverges from the CLI.** `skillset add` replaces an installed
Skill silently. A human typing that command has stated intent; a model calling a tool has not. The
tool takes an overwrite flag, its description states it is only to be set when the User has
explicitly asked to update or replace, and the refusal names the existing Skill so the model has
something concrete to put to the User. The divergence lives in the tool handler, not the shared
installer, so `skillset add` is unaffected.

**The target Agent comes from configuration, not from the tool call.** The Agent invoking the tool
is the Agent being installed for; making the model assert its own identity is a worse interface than
a flag set once. Where the host's advertised identity maps onto a row in the Agent table it may be
used, but the flag is the contract and the fallback.

**The Artifact download records an Install, and needs its own source.** Building the Artifact
archive currently records the Install against the web source unconditionally. ADR-0028 makes each
consumption path responsible for what it records, and a third path now exists, so the source becomes
a parameter with an `mcp` value. Without this, every MCP install is attributed to the web interface.

**`search_skills` is a projection of the existing catalog listing**, filtered to the `skill` Kind,
passing query, Tag, and result-count parameters through to the query the directory view already
supports. It adds no new read path.

## Testing Decisions

A good test here asserts what a caller can observe: the files on disk after an install, the outcome
returned for each Skill in a batch, and the requests that left the process. It does not assert how
the handler got there — not the order of internal calls, not the staging directory's name, not which
helper was used.

**One seam: the tool handler functions.** Each tool is a function taking an injected `fetch`, an
environment, a working directory, a home directory, and the configured Agent and Scope, returning
its result. The MCP protocol layer is a thin registration around these functions and is not itself
tested; standing up a client to assert on filesystem effects would be a worse test of the same
behaviour. This is the same seam and the same shape the CLI's `add` command already has.

**Prior art is the existing CLI command tests**, which are the model to follow rather than a pattern
to reinvent: a hand-written `fetch` stub that answers the Registry's two requests and records every
call, real temporary directories for the project and home roots, an Artifact built in the test with
the same zip helper, and assertions made by reading the filesystem afterwards. No HTTP mocking
library, no filesystem mocking.

The extracted installer keeps the CLI's existing install tests, which move with it and must still
pass unchanged apart from the new staging behaviour.

Behaviour to cover:

- [ ] A search returns the Skills the Registry matched, with `name` and `description`.
- [ ] A search passes its Tag filter and result cap through, and returns only the `skill` Kind.
- [ ] A search with no matches returns an empty result, not an error.
- [ ] An install writes the Artifact's files into the canonical directory and links the configured
      Agent's own directory to it.
- [ ] An install reports which other Agents the same directory already serves.
- [ ] An install of several Skills returns one outcome per Skill.
- [ ] One Skill failing does not prevent the others in the batch from installing.
- [ ] An install refuses when the target exists and overwrite was not requested, and the refusal
      names the Skill.
- [ ] A refused install leaves the existing directory byte-for-byte unchanged.
- [ ] An install with overwrite replaces the target, and no file from the previous version survives.
- [ ] A download that fails leaves no directory at the target.
- [ ] An Artifact that fails validation leaves no directory at the target, and the failure names the
      rule that was broken.
- [ ] No staging directory remains after a successful install, a refused one, or a failed one.
- [ ] The staging directory is created under the target's own parent, which is what makes the move a
      same-filesystem rename.
- [ ] A Skill name that sanitises to nothing is refused rather than installed somewhere unintended.
- [ ] An Agent with no skills directory at the configured Scope takes the fallback branch.
- [ ] The fallback carries the Artifact's location, the Manifest, the intended directory, and the
      `SKILL.md` body.
- [ ] Both tools work with no Token configured.
- [ ] An install records exactly one Install, against the `mcp` source.
- [ ] `skillset add` still installs exactly as it did, now atomically.

## Out of Scope

- **An HTTP transport.** `discourse-mcp` offers one and it would work for `search_skills`, but a
  remote server cannot install — the filesystem steps have no executor — so it would ship half the
  feature under the same name. Worth revisiting as search-only once this exists.
- **Authentication of any kind.** Reads are open (ADR-0013) and no tool writes to the Registry. The
  moment either changes, this is no longer true.
- **A `--toolsets` equivalent.** Two tools do not need partitioning.
- **SEP-2640, the accepted MCP Skills Extension.** It standardises a `skill://` resource convention
  with `skills/list` and `skills/get`, and defines no install mechanism. Its URI shape is close
  enough to these tools that adopting it later is a projection rather than a rewrite, and doing both
  at once would stall the flow that is already agreed. Worth its own spec once this ships.
- **User Scope.** Project Scope only. Nothing prevents the resolver from answering for User Scope
  later; no story here needs it.
- **Kinds other than `skill`.** An MCP Server installs by merging a project's configuration
  (ADR-0029) and a Plugin is a bundle the Registry never looks inside (ADR-0001). Both are real tools
  eventually, neither is this one.
- **Making an installed Skill live in the session that installed it.** Skills are discovered when a
  session starts. The `SKILL.md` body in the result is the mitigation; changing when an Agent loads
  Skills is not ours to do.

## Further Notes

The distribution mechanism, not the transport, is what serves the non-technical User. That is worth
stating because the obvious reading is the opposite one — that a server needing a local process must
be harder to adopt than a URL. `npx` collapses the difference, and stdio then buys back the
filesystem, the validator, and every guarantee in the install sequence. A remote server would have
been easier to reason about and strictly less able to do the job.

The extracted installer is the piece most likely to be skipped under time pressure and the one most
worth keeping. Two copies of "install a Skill" that agree today will not agree after the first
platform-specific bug is fixed in whichever copy the reporter happened to be using.

Two decisions here are corrections of things that read as obviously fine and are not: the staging
directory's placement, which silently breaks a cross-drive install, and the Install source, which
silently misattributes every MCP install to the web interface. Both are cheap now and awkward once
there is data.

The Agent table is hand-curated (ADR-0031) and this feature makes it load-bearing in a new way:
until now a wrong row meant `skillset add` wrote to the wrong place while a human watched, and now
it means a tool call does it unattended. No change is proposed, but a wrong row costs more from here
on.
