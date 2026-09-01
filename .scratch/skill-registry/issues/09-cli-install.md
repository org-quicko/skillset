# 09 — Install a Skill from the CLI

**What to build:** `skillreg add` puts a Skill where a coding Agent will actually read it, asking which Agent and which Scope. This is also the only place a hostile Artifact is stopped, because the API never inspected it.

**Blocked by:** 06 — Publish one Skill from the CLI; 08 — Download a Skill.

**Status:** done — install model revised by ADR-0022 (canonical `.agents/skills` + symlink, full vendored Agent table).

- [x] The Agent table is our own data, carrying the upstream project's MIT notice, its licence text, and the commit the table was derived from in a header comment.
- [x] The full `vercel-labs/skills` Agent list is supported (ADR-0022), each with a project directory and, where the Agent has one, a user-level directory.
- [x] Each Agent's own configuration-directory environment override is honoured, so a non-default setup still installs to a directory the Agent reads.
- [x] Installing prompts for the Agent (searchably, given the list length), then for the Scope.
- [x] Both can be supplied as flags instead, skipping the prompts entirely.
- [x] With no terminal attached and no flags, the command errors rather than choosing a default.
- [x] The Skill's files are written to the canonical `.agents/skills/<name>`; an Agent that reads elsewhere gets a symlink there, falling back to a copy on failure or with `--copy`. The report says which happened, and `--scope user` for an Agent with no user directory errors rather than guessing.
- [x] Extraction tolerates a single wrapping directory and strips it; genuinely ambiguous layouts are refused rather than guessed at.
- [x] Extraction refuses entries with parent-directory segments, absolute paths, drive letters, null bytes, or symlinks, and enforces the uncompressed size and entry-count limits.
- [x] The Skill's name is sanitised before it is used as a directory name.
- [x] Tests cover a universal Agent (no symlink), a non-universal Agent (symlink), `--copy`, the one Agent whose two Scopes use different suffixes (`pi`), and an Agent with no user directory.
