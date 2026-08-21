# 09 — Install a Skill from the CLI

**What to build:** `skillreg add` puts a Skill where a coding Agent will actually read it, asking which Agent and which Scope. This is also the only place a hostile Artifact is stopped, because the API never inspected it.

**Blocked by:** 06 — Publish one Skill from the CLI; 08 — Download a Skill.

**Status:** ready-for-agent

- [ ] The Agent table is our own data, carrying the upstream project's MIT notice, its licence text, and the commit the table was derived from in a header comment.
- [ ] Five Agents are supported — claude-code, codex, github-copilot, opencode, pi — each with a project directory and a user-level directory.
- [ ] Each Agent's own configuration-directory environment override is honoured, so a non-default setup still installs to a directory the Agent reads.
- [ ] Installing prompts for the Agent, then for the Scope.
- [ ] Both can be supplied as flags instead, skipping the prompts entirely.
- [ ] With no terminal attached and no flags, the command errors rather than choosing a default.
- [ ] The resolved directory is shown, and when that directory serves more than one Agent, those Agents are named so nobody runs the command again believing there is more to do.
- [ ] Extraction tolerates a single wrapping directory and strips it; genuinely ambiguous layouts are refused rather than guessed at.
- [ ] Extraction refuses entries with parent-directory segments, absolute paths, drive letters, null bytes, or symlinks, and enforces the uncompressed size and entry-count limits.
- [ ] The Skill's name is sanitised before it is used as a directory name.
- [ ] Every Agent and Scope combination is covered by tests, including the project directory shared by three Agents and the one Agent whose two Scopes use different suffixes.
