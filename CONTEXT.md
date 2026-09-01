# Skillset

A self-hosted registry for Agent Skills. Skills are published from the CLI or the web
interface, stored in object storage, and discovered by members of a single team.

## Language

**Skill**:
A directory bundle whose root holds a `SKILL.md` with YAML frontmatter, alongside any
supporting files it needs.
_Avoid_: Prompt, template, doc, package

**SKILL.md**:
The mandatory file at the root of a Skill. Its frontmatter is the source of truth for the
Skill's `name` and `description`, plus the four optional fields the Agent Skills spec
defines (`license`, `compatibility`, `metadata`, `allowed-tools`); anything else in the
file is ignored.
_Avoid_: Manifest, metadata file

**Tag**:
A short label a Skill can carry for browsing and filtering, never written into its SKILL.md.
Drawn from a catalog shared by the whole Registry, not private to one Skill — a Skill's Tags
are a many-to-many relationship to that catalog, so renaming a Tag changes it everywhere it's
attached.
_Avoid_: Label, category, topic

**User**:
A person with access to the Registry, identified by their email address and described by
a first and last name. The email address is the identity: two logins asserting the same
address are the same User, whichever Identity Provider asserted it.
_Avoid_: Account, member, person

**Admin**:
A User who can create and manage readers and writers, and delete Skills.
_Avoid_: Owner, root

**Superadmin**:
A User who can do everything an Admin can, and additionally create and manage Admins.
There is exactly one Superadmin: the first User to sign up. The role is permanent — never
transferred, reassigned, or removed.
_Avoid_: Owner, root, superuser

**Registry**:
The self-hosted service that holds Skills. Reading a Skill needs no identity; publishing,
deleting, and administration are restricted to the Users who hold the right role. There is
one Registry per deployment, serving one team.
_Avoid_: Server, hub, marketplace, repository

**Artifact**:
The zip archive of a Skill, uploaded directly to object storage by the client and stored
as a single object per Skill.
_Avoid_: Bundle, package, tarball, blob

**Install**:
A recorded, countable instance of a Skill being obtained — one event per occurrence,
produced by a web Download of its Artifact or (once the CLI exists) `skillreg add`. A
Skill's install count is the total number of Install events recorded for it. "Download"
still names the plain act of fetching the Artifact's bytes; every Download produces one
Install event, but Install is the countable unit the log, the count, and the API's
`installs` field are named after.
_Avoid_: Download (as the countable unit — Download is the action, Install is the count)

**Token**:
A secret a User mints to let the CLI act as them. Shown once, stored only as a hash, and
carrying whatever role its owner has.
_Avoid_: API key, credential, secret

**Agent**:
A coding agent that reads Skills from a conventional directory on a developer's machine.
The offered list is the full Agent → directory table vendored from `vercel-labs/skills`
(ADR-0022). `add` writes to the canonical `.agents/skills` and symlinks the chosen Agent's
own directory to it.
_Avoid_: Client, tool, editor, IDE

**Scope**:
Where a Skill is installed on a machine — either the current project, or the Agent's
user-level directory.
_Avoid_: Target, location, level, destination

**Identity Provider**:
A configured way for a User to prove who they are without a password, offered on the login page
beside the password form. There are three kinds — Google Workspace, Microsoft Entra, and GitHub —
and at most one Provider of each kind, any number of which may be enabled at once. A Provider
vouches for an email address and for the Permitted Organisations that address belongs to;
the Registry trusts it for nothing else. Proving identity is all a Provider does — for GitHub it is
one of the two capabilities its Integration offers, and the other is switched separately.
_Avoid_: SSO, social login, connection, OIDC provider (as the domain term)

**GitHub Integration**:
The Registry's single registration with GitHub, offering two capabilities that are switched on
independently: Sign-in, which makes GitHub an Identity Provider, and Import, which lets a writer
read a Skill out of a repository. Either may be on without the other (ADR-0023).
_Avoid_: GitHub app, GitHub provider (for the whole registration), connector

**Connection**:
A writer's own grant of repository access to the Registry, made deliberately and separately from
signing in. It is what an Import reads a private repository as, so it reaches exactly what that
writer can already read — and it need not be the same GitHub account they sign in with. Revoking
one stops the Registry using it; it does not withdraw the grant at GitHub.
_Avoid_: Link, linked account, authorisation, integration

**Permitted Organisation**:
One value a Provider admits people from: a Workspace domain for Google, a tenant id for
Microsoft, an organisation login for GitHub. A Provider holds a list of them and admits a login
matching any one. Always matched against what the Provider asserts — a claim, or a live membership
check — and never inferred from an email address's suffix.

They are the only control on who gets an account, and a Provider may be enabled with none listed,
which turns the check off and admits everyone that provider authenticates (ADR-0021). An
_ungated_ Provider is the term for that state.
_Avoid_: Allowed domain, whitelist, tenant (as the general term), hosted domain
