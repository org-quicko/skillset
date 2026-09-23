# A Lockfile Records What Was Installed, and Two Digests Tell Stale From Edited

`skillset install` and `install_skills` now write a `skillset-lock.json` at the project root
(or the home directory, for user Scope), recording for each Skill its Registry id, the
Registry's `updated_at` at the moment it was installed, and a SHA-256 digest of the files that
were written. `list`/`installed_skills`, `update`/`update_skills`, and `remove`/`remove_skills`
are built on it.

This is what makes a Skill's state answerable at all. Before it, an installed Skill was a
detached copy on disk with no link back: nothing could say whether it was current, whether
anyone had edited it, or even where it came from.

## Why this works without versioning

Versioning (ADR-0002 — there is none) would give a natural staleness signal. In its absence,
`resources.updated_at` is one: it moves on every republish and on nothing else. A client
that stores the value it saw at install time can compare and know. `updated_at` is therefore
now part of the Skill read shape, which it was not before.

That covers *remote* change. It says nothing about *local* change, which is the other half
and the more damaging one, so the lockfile stores a second, independent signal: a digest over
the installed files. Re-reading the directory and re-digesting it detects an edit the
Registry cannot know about.

The two are deliberately separate. `content_hash` keeps working with the Registry
unreachable — `skillset list --offline` still reports `modified` — and `registry_updated_at`
keeps working on a Skill nobody has touched. Neither substitutes for the other.

`modified` is reported ahead of `outdated` when a Skill is both, because it is the finding
that costs someone work: a stale copy can be replaced freely, an edited one must not be
replaced without being asked.

## Considered Options

**Waiting for versioning.** The honest option, and rejected on sequencing rather than
principle: versioning is a larger change reaching storage keys, the API, the CLI and the
installer, and everything above is useful before it lands. When it does, the lockfile gains a
`version` field and pin semantics; the format is already shaped to take one. Until then
`update` always means "move to whatever is current", with no pin and no rollback. That
limitation is real and is the reason `--force` exists rather than being the default.

**A digest from the Registry instead of a local one.** Storage's own ETags were the obvious
source, but `StorageAdapter.list` returns key and size only, and an Artifact is many objects
(ADR-0032) — there is no single server-side digest to fetch, and synthesising one means
reading every object on a path that deliberately does not (ADR-0001). Digesting locally costs
one directory read and answers a question the server could not answer anyway: whether *this
copy* was edited.

**Comparing file sizes rather than hashing.** Cheaper and enough to catch careless edits.
Rejected because the case that matters — someone tuning a prompt in a `SKILL.md` — routinely
leaves the length unchanged.

**Putting the lockfile inside `.agents/`.** Rejected: an Agent scanning its skills directory
would find it, and the file is the User's record of what they installed rather than part of
any Agent's tree. The project root is where a lockfile is looked for.

## Consequences

**A lockfile is per Scope, and there may be two.** A project install records at the project
root, a user install in the home directory. Every lockfile-aware command takes `--scope` and
defaults to `project`, and names the Scope in its output so a listing is never ambiguous
about which one it read.

**`skillset install` refuses a locally-modified target unless `--force`.** This is a behaviour
change: it used to replace the directory silently. The MCP server's `install_skills` already
refused an existing install by default, and the two now agree.

**The lockfile is advisory, not authoritative.** A missing, corrupt, or newer-format file
reads as empty rather than throwing, because a bad lockfile must not stop an install. Nothing
signs it, so it is not a security boundary — it detects accidents, not tampering.

**A Skill installed before this, or by hand, has no entry.** It cannot be judged, and
`install` will replace it as it always did. The first `install`/`update` records one.

**Removal and update unlink whichever Agent is detected now**, not one the lockfile
remembers — the lockfile records no Agent, so `remove`/`remove_skills` and `update`/
`update_skills` run the same detection ladder `install` falls back to (ADR-0034) and act on
its answer. Removing a Skill installed for Cursor from a Claude Code session can therefore
unlink Claude Code's directory instead of Cursor's, if that is what the ladder resolves to
when the command runs; the canonical copy always still goes.

**The orchestration lives in `packages/installer`, not in each client.** `readInstalled`,
`recordInstall`, and `forgetInstall` are shared, with the Registry reached through an injected
lookup so the package stays free of HTTP. The CLI and the MCP server each supply their own.
This is a departure from ADR-0035's "duplicated rather than extracted" for the file walk, and
deliberately: a status rule that disagreed between the two clients would be a bug a user sees,
which a duplicated directory walk is not.
