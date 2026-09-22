# Skillset

A self-hosted registry for the things a coding agent loads — Skills, MCP Servers, and Plugins.
Resources are published from the CLI or the web interface, stored as rows and (for the Kinds that
have bytes) as files in object storage, and discovered — read, previewed, and installed — by
members of a single team.

## Language

**Resource**:
Anything the Registry holds and a coding agent can obtain. Every Resource has a Kind, a Namespace,
a `name` unique within that pair, a description, a publisher, optional markdown documentation
(`body`), and any number of Tags; everything else about it lives in its Kind-specific payload
(ADR-0026). Not every Resource has an Artifact (ADR-0027).
_Avoid_: Package, entry, item, asset, artifact (which is the files, not the thing)

**Kind**:
Which of the three things a Resource is — `skill`, `mcp-server`, or `plugin`. A Kind fixes the
shape of the payload, the rules `name` and `description` must satisfy, whether there is an
Artifact, and what `skillset install` does. Stored as plain text rather than an enum, so a fourth
Kind is an insert rather than a migration (ADR-0026, following ADR-0024).
_Avoid_: Type, category, class, resource type

**Namespace**:
Which party named a Resource, and the other half of its publishing identity: unique is
`(kind, namespace, name)` rather than `(kind, name)`, so two Skills may both be called
`frontend-design` so long as different parties named them. Declared at publish time, never
derived — an Import defaults to the `owner/repo` it was copied out of, and anything published
straight here defaults to this Registry's own host, forward rather than the reverse-DNS a Source
resolves to (`skills.quicko.com`, not `com.quicko.skills`), because a Namespace is read and typed
where a Source is only ever linked. A republish resolves the Namespace a Resource already has
rather than deriving a fresh one, since deriving would fork it instead of updating it. An opaque
string throughout: lowercase alphanumerics, dots, hyphens, and at most one slash, compared whole
and never split. It confers nothing — no ownership, no permission, no claim on the name — and it
is never renamed, because a rename would re-identify every Resource beneath it. Required for a
Skill; an MCP Server has none, its `name` being already namespaced by the upstream specification.

A Registry concept, and only that: installs stay flat at `.agents/skills/<name>` (ADR-0022), so
one project holds at most one Skill of a given name however many Namespaces publish it. Reverses
ADR-0002, which rejected namespacing on the premise of a single team — a premise Import expired
by bringing in Skills named by parties who were never on it.
_Avoid_: Scope (which is where a Skill is installed), owner, org, vendor, prefix, group

**Skill**:
The Kind whose payload is a directory bundle: a root `SKILL.md` with YAML frontmatter, alongside
any supporting files it needs. Has an Artifact.
_Avoid_: Prompt, template, doc, package

**SKILL.md**:
The mandatory file at the root of a Skill. Its frontmatter is the source of truth for the Skill's
`name` and `description`, plus the four optional fields the Agent Skills spec defines (`license`,
`compatibility`, `metadata`, `allowed-tools`); anything else in the file is ignored. Everything
below the frontmatter becomes the Resource's `body`.
_Avoid_: Manifest, metadata file

**MCP Server**:
The Kind that is pure metadata — a `server.json`-shaped record naming where a Model Context
Protocol server actually comes from: either `packages[]` (an npm, PyPI, OCI, NuGet, Cargo or MCPB
identifier with its transport, arguments and environment variables) or `remotes[]` (a URL and
transport). **The Registry stores no bytes for it** (ADR-0027) — it is a pointer, exactly as the
public MCP registry is. Its `name` is reverse-DNS with a single slash and its `description` is
capped at 100 characters, both fixed by the upstream specification and neither compatible with a
Skill's rules.
_Avoid_: MCP, server, tool server, connector

**Plugin**:
The Kind that bundles Resources for an agent to load together — a repository with a
`.claude-plugin/plugin.json` manifest and any of `skills/`, `commands/`, `agents/`, `hooks/`,
`.mcp.json`. Has an Artifact, and the Registry never looks inside it (ADR-0001): the Skills a
Plugin contains are its own business, not rows in this Registry.
_Avoid_: Bundle, pack, extension, marketplace (which is the document that lists Plugins)

**Tag**:
A short label a Resource can carry for browsing and filtering, never written into its payload.
Drawn from one catalog shared by the whole Registry — shared across Kinds too, so a Skill and an
MCP Server can carry the same Tag — and a Resource's Tags are a many-to-many relationship to that
catalog, so renaming a Tag changes it everywhere it's attached.
_Avoid_: Label, category, topic

**User**:
A person with access to the Registry, identified by their email address and described by
a first and last name. The email address is the identity: two logins asserting the same
address are the same User, whichever Identity Provider asserted it.
_Avoid_: Account, member, person

**Admin**:
A User who can create and manage readers and writers, and delete Resources.
_Avoid_: Owner, root

**Superadmin**:
A User who can do everything an Admin can, and additionally create and manage Admins.
There is exactly one Superadmin: the first User to sign up. The role is permanent — never
transferred, reassigned, or removed.
_Avoid_: Owner, root, superuser

**Registry**:
The self-hosted service that holds Resources. Reading a Resource needs no identity; publishing,
deleting, and administration are restricted to the Users who hold the right role. There is
one Registry per deployment, serving one team.
_Avoid_: Server, hub, marketplace, repository

**Artifact**:
The files of a Resource of a Kind that has one — Skill and Plugin. Uploaded directly to object
storage by the client, one object per file, under a prefix keyed by the Resource's `id`
(ADR-0026, ADR-0032). An MCP Server has no Artifact at all (ADR-0027). A **zip** is one
*representation* of an Artifact rather than the Artifact itself: the Registry assembles one on
demand for `skillset install`, the web Download control, and a Marketplace `archive` source, and
stores none.
_Avoid_: Bundle, package, tarball, blob, zip (which is a representation, not the thing)

**Manifest**:
An Artifact's files as a list of paths and sizes, with no content. It travels in both directions
and means something slightly different each way: publishing *declares* one, which is what lets
the Registry validate every path and enforce the file-count and size limits without reading any
bytes (ADR-0001, ADR-0032), and reading returns the *actual* one, listed back from storage. The
two agree once an upload has finished, and the read is the one to trust.
_Avoid_: File list, index, tree, contents

**Lockfile**:
A `skillset-lock.json` at a project root, or in a User's home directory for user Scope,
recording every Skill installed *there*: its Resource id, the Registry's `updated_at` at the
moment it was installed, a digest of the files that were written, when, and which Agent was
linked. It is what makes an installed Skill's state answerable — whether the Registry has
moved on, and whether anyone has edited the copy on disk — neither of which anything could
tell before (ADR-0038). Advisory rather than authoritative: a missing or corrupt one reads as
empty rather than failing an install, and nothing signs it.
_Avoid_: Manifest (which is an Artifact's file list), lock, state file

**Status**:
How one installed Skill stands, as the Lockfile's two recorded signals answer it. `current` is
unchanged on both. `outdated` means the Registry's `updated_at` has moved. `modified` means the
files on disk no longer digest to what was written. `missing` means the Lockfile records a
Skill whose directory is gone. A Skill that is both edited and stale reports `modified`,
because that is the one needing a decision (ADR-0038).
_Avoid_: State, drift, dirty

**Install**:
A recorded, countable instance of a Resource being obtained — one event per occurrence. What
"obtained" means depends on the Kind: a Download of the Artifact for a Skill or a Plugin, and the
config being written or revealed for an MCP Server. Browsing an Artifact's files, or previewing
one of them in the interface, is not obtaining and counts as nothing (ADR-0032). Counts are
therefore **not comparable across Kinds** (ADR-0028), and no longer order the catalog by default. "Download" still names the plain
act of fetching an Artifact's bytes; every Download produces one Install event, but Install is
the countable unit the log, the count, and the API's `installs` field are named after.
_Avoid_: Download (as the countable unit — Download is the action, Install is the count)

**Marketplace**:
The `.claude-plugin/marketplace.json` document the Registry serves so an off-the-shelf agent can
install from it natively, without `skillset` (ADR-0030). It lists Skills and Plugins as plugin
entries with `archive` sources; MCP Servers are not listed, because listing one would mean
synthesising bytes the Registry deliberately does not have.
_Avoid_: Index, catalog (which is the Registry's own browse surface), discovery, feed

**Token**:
A secret a User mints to let the CLI act as them. Shown once, stored only as a hash, and
carrying whatever role its owner has.
_Avoid_: API key, credential, secret

**Agent**:
A coding agent that reads Skills from a conventional directory on a developer's machine.
The offered list is a hand-curated Agent → directory table, each row verified against that
Agent's own documentation (ADR-0031). `install` writes to the canonical `.agents/skills` and
symlinks the chosen Agent's own directory to it (ADR-0022). The table is about **Skills
only**: an MCP Server is installed by merging a project's `.mcp.json` and names no Agent
(ADR-0029).
_Avoid_: Client, tool, editor, IDE

**Scope**:
Where a Resource is installed on a machine — either the current project, or the Agent's
user-level directory. An MCP Server has project Scope only (ADR-0029).
_Avoid_: Target, location, level, destination

**Identity Provider**:
A configured way for a User to prove who they are without a password, offered on the login page
beside the password form. There are three kinds — Google Workspace, Microsoft Entra, and GitHub —
and at most one Provider of each kind, any number of which may be enabled at once. A Provider
vouches for an email address and for the Permitted Organisations that address belongs to;
the Registry trusts it for nothing else. Proving identity is all a Provider does — a GitHub
Identity Provider knows nothing of the GitHub Integration an Import reads a repository through,
and the two are registered, granted, and revoked separately.
_Avoid_: SSO, social login, connection, OIDC provider (as the domain term)

**Git Provider**:
A hosted git service the Registry can read a Resource's folder from. GitHub and GitLab are the two
it knows. A Git Provider is not an Identity Provider, even where the same company is both: GitHub
is reached through two separate registrations, one for signing in and one for Importing, and
neither knows about the other.
_Avoid_: Source, repository host, VCS, forge

**Integration**:
The Registry's registration with one Git Provider, holding the credential pair a Connection is
granted against. There is at most one per Git Provider, and Importing is available for exactly
those Git Providers that have one — there is no separate switch. An Integration grants nobody an
account, which is the whole of what separates it from an Identity Provider.
_Avoid_: App, connector, GitHub app, provider (unqualified)

**Connection**:
A writer's own grant of repository access to the Registry, made deliberately and separately from
signing in. It is what an Import reads a private repository as, so it reaches the repositories its
Integration was granted — which is not everything that writer can read — and it need not be the
same account they sign in with. Revoking one stops the Registry using it; it does not withdraw the
grant at the Git Provider.
_Avoid_: Link, linked account, authorisation, integration

**Import**:
A one-time copy of a Skill's or a Plugin's files out of a Git Provider and into the Registry. It is
not a link: nothing is ever re-read, and nothing syncs. What was published records the repository
it came from as its Source, which is a historical note rather than a reference — nothing follows
it (ADR-0041). A public folder needs no Connection; a private one is read as the writer's own
Connection. An MCP Server is never Imported — its whole payload is a `server.json` a writer
pastes.
_Avoid_: Sync, clone, pull, link

**Source**:
Where a Resource came from, as one value every read returns. An Imported Resource's Source is the
**repository** URL it was copied out of — without the ref or the folder, so a monorepo's Skills
share one. Anything published straight to the Registry has this Registry itself as its Source,
written as its domain in reverse-DNS notation (`com.quicko.skills`). One is an address and the
other an identity, which is why only the first is ever shown: a Source appears — as its Git
Provider's mark, linking out — only when it points somewhere the reader cannot already see, and a
Resource published here shows none at all. Declared by the publisher rather than inferred — the
Registry never opens an Artifact to find out (ADR-0001) — and only the URL form is declarable: the
reverse-DNS form is what declaring nothing means. Provenance, not a link: a republish from disk
clears an earlier Import's Source, and a repository that moves leaves the recorded value untouched
and wrong.
_Avoid_: Origin, provider, upstream, remote, repository (which is one kind of Source, not the term)

**Permitted Organisation**:
One value a Provider admits people from: a Workspace domain for Google, a tenant id for
Microsoft, an organisation login for GitHub. A Provider holds a list of them and admits a login
matching any one. Always matched against what the Provider asserts — a claim, or a live membership
check — and never inferred from an email address's suffix.

They are the only control on who gets an account, and a Provider may be enabled with none listed,
which turns the check off and admits everyone that provider authenticates (ADR-0021). An
_ungated_ Provider is the term for that state.
_Avoid_: Allowed domain, whitelist, tenant (as the general term), hosted domain
