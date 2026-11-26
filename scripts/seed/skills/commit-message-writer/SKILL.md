---
name: commit-message-writer
description: Writes Conventional Commit messages from a staged diff. Use when the user asks for a commit message or is about to commit.
license: MIT
---

# Commit message writer

1. Read the staged diff with `git diff --cached`.
2. Pick the type: `feat`, `fix`, `refactor`, `docs`, `test` or `chore`.
3. Write a subject of at most 72 characters, in the imperative mood.
4. Add a body only when the reason for the change is not obvious from the diff.
