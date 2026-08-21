# 03 — Publish a Skill through the API

**What to build:** A writer can publish a Skill over HTTP and read it back. This is the spine: the shared parse-and-validate pipeline, the Skills table, real S3 storage, and the read routes. No browser involvement — this ticket is verifiable by tests and by hand against the API.

**Blocked by:** 02 — First Admin and sessions.

**Status:** ready-for-agent

- [ ] The shared module parses `SKILL.md` frontmatter and validates a Skill: name present, 1–64 characters, lowercase alphanumerics and hyphens only, no leading, trailing, or doubled hyphen; description present and at most 1024 characters; a `SKILL.md` at the Skill's root.
- [ ] The shared module produces an Artifact archiving the Skill's contents at its root rather than a wrapping directory.
- [ ] Version-control metadata, dependency directories, dotfile directories, and editor artifacts are excluded before the Artifact is built.
- [ ] Structural limits are enforced: at most 10 MiB transferred, 25 MiB uncompressed, 1000 entries.
- [ ] Publishing creates or replaces the Skill's row — name, description, `SKILL.md` body, publisher, published-at — and returns a presigned upload location.
- [ ] The API validates the posted metadata against the shared schema and rejects it naming the specific rule that failed.
- [ ] Publishing is refused to readers and allowed to writers and Admins.
- [ ] Publishing an existing Skill replaces it, whoever published it first, and the publisher and published-at reflect whoever published it last.
- [ ] The S3 storage adapter implements the contract declared in ticket 01.
- [ ] Listing returns Skills most-recently-published first, paginated at 50 via a page parameter.
- [ ] Reading a single Skill by name returns its description, body, publisher, and published-at, and does not go through search.
- [ ] Validation rules are covered as table-driven cases in the shared module; everything else is covered at the API boundary.
