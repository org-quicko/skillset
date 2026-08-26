# Skill Registry

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
a first and last name.
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
The self-hosted service that holds Skills and the Users who may reach them. There is one
Registry per deployment, serving one team.
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
Only Agents whose directories have been verified are offered.
_Avoid_: Client, tool, editor, IDE

**Scope**:
Where a Skill is installed on a machine — either the current project, or the Agent's
user-level directory.
_Avoid_: Target, location, level, destination
