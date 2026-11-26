---
name: changelog-writer
description: Turns the commits since the last tag into a Keep a Changelog entry. Use before cutting a release.
---

# Changelog writer

1. List commits with `git log $(git describe --tags --abbrev=0)..HEAD --oneline`.
2. Group them under Added, Changed, Fixed and Removed.
3. Drop merge commits and chores that users do not see.
