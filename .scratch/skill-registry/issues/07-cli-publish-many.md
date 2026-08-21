# 07 — Publish many Skills from the CLI

**What to build:** Point publishing at a path and every Skill beneath it goes up together — with a chance to stop first, because publishing replaces and only an Admin can undo it.

**Blocked by:** 06 — Publish one Skill from the CLI.

**Status:** ready-for-agent

- [ ] Any directory holding a `SKILL.md` is a Skill, and the walk does not descend into one once it has found it — a Skill's supporting directories are never mistaken for Skills of their own.
- [ ] The walk stops at three levels deep.
- [ ] Version-control metadata, dependency directories, and dotfile directories are skipped.
- [ ] If the given path itself holds a `SKILL.md`, exactly that Skill is published and the walk does not run.
- [ ] Every discovered Skill is validated before any is published; a single failure aborts the batch and publishes nothing at all.
- [ ] When more than one Skill is discovered, the Skills that will be replaced are listed and confirmation is required before anything is published.
- [ ] A flag skips the confirmation, so automation is not blocked on a prompt.
- [ ] The outcome of each Skill is reported individually, and an upload failure part-way through does not prevent the remaining results from being reported.
