# Skill Registry

A self-hosted registry for Agent Skills. Skills are published from the CLI or the web
interface, stored in object storage, and discovered by members of a single team.

## Language

**Skill**:
A directory bundle whose root holds a `SKILL.md` with YAML frontmatter, alongside any
supporting files it needs.
_Avoid_: Prompt, template, doc, package

**SKILL.md**:
The mandatory file at the root of a Skill. Its frontmatter is the sole source of truth
for the Skill's name and description.
_Avoid_: Manifest, metadata file

**User**:
A person with access to the Registry, identified by their email address and described by
a first and last name.
_Avoid_: Account, member, person

**Admin**:
A User who can create and manage other Users. The first User to sign up is an Admin, and
there may be many.
_Avoid_: Owner, superuser, root

**Registry**:
The self-hosted service that holds Skills and the Users who may reach them. There is one
Registry per deployment, serving one team.
_Avoid_: Server, hub, marketplace, repository

**Artifact**:
The zip archive of a Skill, uploaded directly to object storage by the client and stored
as a single object per Skill.
_Avoid_: Bundle, package, tarball, blob

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
