# 10 — Search Skills

**What to build:** One search input that finds a Skill by the problem it solves, not just by the name somebody else chose for it.

**Blocked by:** 04 — Publish a Skill from the web interface.

**Status:** ready-for-agent

- [ ] The Skills table carries a generated full-text column over name and description with an index over it, added by a hand-written migration.
- [ ] Searching accepts a plain phrase, and supports quoted phrases and exclusions.
- [ ] Results are paginated the same way the unfiltered list is.
- [ ] The search term is part of the query key, and results do not empty out while a new term loads.
- [ ] Reading a Skill by exact name still bypasses search entirely.
- [ ] An empty search returns the ordinary most-recent-first list.
- [ ] The known limits are recorded in the tests as expected behaviour, not defects: stemming does not substring-match, and hyphenated names tokenise per word.
