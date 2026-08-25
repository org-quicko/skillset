# 01 — Publish a Skill from a GitHub URL

**What to build:** A second way to supply a Skill's files on the publish screen, alongside the
existing drop zone: a GitHub URL field. Pasting a public repository's URL, or a URL to a
subdirectory within one, fetches that folder's files straight from GitHub (anonymously, client-side)
and feeds them into the exact same validate-then-publish pipeline a dropped folder already goes
through. No API, CLI, or server-side change.

**Status:** open

- [ ] `parseGitHubSkillUrl` (packages/shared) accepts a bare repository URL and a `tree/<ref>/<path>`
      folder URL, and rejects anything else — wrong host, a `blob` URL, a `tree` URL missing a path
      — before any network call, with a message naming what was expected.
- [ ] `fetchGitHubSkillFiles` (apps/web) resolves the default branch when the URL names none, walks
      the folder via GitHub's Contents API, and fetches each file's bytes from its `download_url` —
      producing a `SkillFile[]` shaped exactly like a dropped folder's.
- [ ] The publish screen's new URL field hands a successful fetch to the same `handleFiles` the drop
      zone already uses, so a GitHub-sourced Skill gets the identical validation, Artifact build,
      `PUT`, and presigned upload as a dropped one — including replacing an existing Skill of the
      same name.
- [ ] A URL that isn't shaped like a GitHub repository or folder link is rejected immediately, with
      a clear reason, before any request is made.
- [ ] A 404 (repository or path not found, or private), a rate-limited request, and a network
      failure each get their own plain, writer-facing message.
- [ ] `parseGitHubSkillUrl` is table-driven tested in `packages/shared/test` — accepted shapes and
      rejected shapes.

---
Spec: `.scratch/publish-from-github/spec.md`
ADR: `docs/adr/0010-github-fetch-is-client-side-and-public-only.md`
