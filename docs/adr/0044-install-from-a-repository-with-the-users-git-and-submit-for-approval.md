# 44. Install from a repository with the User's own git, and submit it for approval

## Status

Accepted. Partly reverses [ADR-0043](0043-the-cli-reads-a-git-provider-itself.md): `install` reaches
a repository through `git clone` rather than the anonymous provider walk, which 0043 rejected.
`publish --from` is unchanged and stays anonymous. Depends on
[ADR-0041](0041-a-resource-records-where-it-came-from.md) and
[ADR-0042](0042-a-resource-is-identified-by-kind-namespace-and-name.md) for what an approved
Submission records and is named by, and on
[ADR-0038](0038-a-lockfile-records-what-was-installed.md) for the lockfile.

## Context

`skillset install` could install only what was already in the Registry. A Skill living in a
repository — including a private one the User can clone every day — had to be published before
anyone could use it, and publishing is a writer's job. A reader wanting to try a Skill had no path
at all, and a writer had to put something in front of the whole team before trying it themselves.

ADR-0043 expected `install` to read a public folder anonymously. That works only for public
repositories and spends GitHub's sixty-request budget. It also leaves the Registry with no idea the
Skill is in use.

## Decision

**`skillset install <url>` clones with the User's own git.** It runs a shallow, blob-less, sparse
`git clone` of just the folder the URL names into a temporary directory. Git's own configuration
applies: credential helpers, `insteadOf` rewrites to SSH, and so on. So anything the User can clone
installs, private repositories included, and no credential ever passes through this CLI.
`GIT_TERMINAL_PROMPT=0` makes a missing credential fail rather than hang behind captured output.
The URL must name exactly one Skill; a folder holding several is refused with each one's path.

**The install is recorded in the lockfile** with its `source`, its Namespace (`owner/repo`), and
`id` and `registry_updated_at` both `null`, meaning "not in the Registry yet".

**Then, when a Token is configured, it is submitted for approval.** A Submission is a row in
`resource_submissions`, with its files under `submissions/<id>/` in storage. Submitting is open to
every signed-in role, because it publishes nothing. A Resource that already exists under the same
`(kind, namespace, name)` is not submitted. Submitting the same Resource again replaces the pending
Submission.

**An Admin approves or rejects it.** Approving creates the Resource, credited to the submitter,
copies the files into its Artifact, and deletes the Submission. Rejecting deletes both.

**The lockfile hands over by itself.** `list` and `update` look each Skill up by the Namespace the
lockfile recorded. Before approval there is nothing to find: `list` reads `current` and `update`
reads `pending`. After approval the Registry reports a revision that differs from `null`, so the
Skill reads `outdated` and `update` moves it onto the Registry's copy.

## Considered Options

**A status column on `resources`.** Approval would become a one-column update rather than a copy.
Rejected: every catalog read — the directory view, search, stats, by-name, the Artifact and file
routes — would have to filter pending rows out, and missing one filter leaks an unapproved Resource
to everyone. A separate table makes that leak impossible rather than merely avoided. It is named for
Resources rather than Skills, and carries the same `kind` and `payload` pair, so a second Kind needs
no second table.

**The anonymous provider walk (ADR-0043).** Rejected for `install`: it is public-only, which is
exactly the case this feature exists for. It stays for `publish --from`.

**A provider token from `git credential fill` passed to the existing walk.** It would have kept one
fetch mechanism, but it does not cover SSH-only setups, and it makes the CLI handle a credential it
otherwise never sees.

## Consequences

**`install <url>` needs git on `PATH`.** Only that path does; installing by name needs nothing new.

**A tree URL at a commit SHA is refused by git,** because `--branch` takes branches and tags only.

**The Registry stores bytes an Admin has not approved,** under a prefix no read route can reach.
Rejecting deletes them, and nothing else cleans up a Submission that is never reviewed.

**The MCP server reads the same lockfile.** It now looks Skills up by their recorded Namespace too,
and its `update_skills` leaves a pending Skill alone rather than trying to restore it from a
Registry that does not have it.
