# A Subagent Is a Kind With a Single-File Artifact

The Registry gains a fourth Kind, `subagent`: a subagent definition a coding Agent loads to
delegate work to — one markdown file whose YAML frontmatter carries `name`, `description`, and
optionally `tools` and `model`, and whose body is the subagent's system prompt
(`.claude/agents/code-reviewer.md` is the shape). It has an Artifact, and that Artifact is exactly
one file, `<name>.md`. Its `name` follows a Skill's rules (1–64 lowercase alphanumerics and
hyphens, which is also Claude Code's own convention), its `description` is capped at 1024
characters, its payload is `{ kind: "subagent", tools?, model? }`, and its `body` is the system
prompt.

The Kind is called `subagent`, not `agent`, because **Agent** already names the coding tool that
reads Resources (CONTEXT.md, ADR-0031). Calling both "agent" would make `install --agent
claude-code agent/reviewer` unreadable and blur the one table the CLI is built around.

## Considered Options

**No Artifact — the row is the whole subagent.** Tempting, because a subagent is small enough
that `body` plus a payload of frontmatter fields holds all of it, and `install` could write the
file back out. Rejected: rebuilding the file means the Registry decides what the frontmatter
says, so every key it does not model (`color`, `permissionMode`, whatever an Agent adds next) is
silently dropped on the way through. It would also need a second install, download and
file-preview path beside the one Skills already use. Keeping the file as published costs nothing
and loses nothing.

**A folder Artifact like a Skill's**, with an entry file such as `AGENT.md` and room for
supporting files. Rejected: no Agent reads a subagent that way. Claude Code loads one `.md` per
subagent from a flat directory, and an Artifact shaped differently from what lands on disk is a
translation step nobody asked for.

**Naming the Kind `agent` and renaming today's Agent.** Rejected for churn: Agent appears in the
CLI's flags, the shared table, the MCP server's detection (ADR-0034) and a dozen ADRs, all of
which would move to buy a shorter path segment.

## Consequences

A Subagent reuses the Skill pipeline wholesale — presigned upload, `/files`, zip download, Install
counting (ADR-0028: a Download is an Install), search over `body` — because it is a bundle Kind
with a one-entry Manifest. The only new rule is on the Manifest: exactly one file, named after the
Resource. ADR-0001 is unchanged: the client parses the frontmatter and claims it, and the
Registry never opens the file.

`tools` is stored as a comma-separated string, folded from a YAML list where one is written, for
the reason ADR-0009 stores `allowed-tools` that way.

Git Import, the Marketplace projection (ADR-0030) and the MCP server's tools do not list
Subagents yet. Each is a later, separate decision, not an implied one.
