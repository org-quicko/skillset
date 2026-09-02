# Publish a Skill from a private GitHub repository

> **Superseded by `.scratch/github-import/spec.md` (ADR-0024).** This spec describes importing
> with the sign-in OAuth token and the `repo` scope. That credential is gone: the import
> credential is a separately registered GitHub App granting `contents: read`, and the grant is a
> Connection in its own table. Kept for the reasoning behind running as the caller and closing the
> request-forgery surface, both of which still govern. Do not build from the credential sections.

## What to build

Publishing from a GitHub URL works today for public repositories only: the browser fetches the
folder anonymously and feeds it to the publishing pipeline (ADR-0010). A team that keeps its Skills
in a private repository gets nothing from that field and has to clone the repo and drag the folder
in instead.

This extends the same field to private repositories. A writer who has signed in with GitHub pastes
the URL exactly as they do now; if the anonymous fetch cannot see the repository, the Registry
retries server-side using that writer's own GitHub token and publishes what it finds. Nothing about
the publish screen's flow changes — same field, same button, same validation, same Artifact.

Settled in ADR-0020. Public repositories keep the anonymous client-side path unchanged.

## Decisions

Repeated here as the shape the criteria assume; each is argued in ADR-0020.

**The import runs as the caller**, using the GitHub OAuth token on their linked account. It reaches
exactly the repositories that writer can already read, and a writer who has never signed in with
GitHub is told to do so rather than silently getting someone else's access.

**The API takes parts, never a URL.** `POST /github/skill-files` receives
`{ owner, repo, ref, path }` and builds every GitHub request itself, so it cannot be pointed at
another host. The browser still parses the pasted URL, and the server re-validates every part.

**Public repositories are unchanged.** The browser tries anonymously first. Only when that fails to
find the repository does the server-side path run, so public publishing costs the Registry nothing
and still works for a writer with no GitHub sign-in.

**The `repo` scope is requested at login**, for everyone signing in with GitHub, rather than at
first import. ADR-0020 records what that grants and why the second consent screen was not worth it.

**No new configuration.** Connecting GitHub is signing in with GitHub; there is no separate connect
step, no credential for an operator to paste, and no new table.

## Acceptance criteria

### Importing

- [ ] A writer signed in with GitHub can publish a Skill from a private repository they can read,
      by pasting its URL into the existing field.
- [ ] The files reach the same `buildSkillBundle` → `PUT /skills/{name}` → presigned-upload pipeline
      a dropped folder does, so a privately-sourced Skill is validated no differently.
- [ ] A subdirectory URL (`/tree/<ref>/<path>`) imports just that folder, as it does for a public
      repository.
- [ ] A URL with no ref resolves the repository's default branch.
- [ ] Symlink and submodule entries are dropped, matching the existing walk.
- [ ] Paths in the result are relative to the folder named by the URL, not the repository root.

### Who can import, and as whom

- [ ] The route requires at least the `writer` role — importing exists to publish, and a reader
      cannot publish.
- [ ] The import uses the calling writer's own GitHub token and no one else's.
- [ ] A writer with no linked GitHub account gets a distinct, actionable error telling them to sign
      in with GitHub — not a generic failure and not a 404.
- [ ] The token is read from the database on each import, so revoking the link or re-authorising
      takes effect on the next attempt.
- [ ] The token is decrypted before it reaches GitHub. It is stored encrypted, so sending the
      column's value verbatim would fail every import against a real GitHub.

### Not a request-forgery surface

- [ ] The route accepts no URL field. Owner, repo, and ref are rejected unless they match
      `[A-Za-z0-9._-]+`; a `path` containing a `.` or `..` segment, or a leading or trailing slash,
      is rejected.
- [ ] Redirects are not followed on any GitHub request.
- [ ] A file's `download_url` is fetched only when it points at `raw.githubusercontent.com`.
- [ ] Rejections here are validation errors, before any outbound request is made.

### Limits

- [ ] A folder with more than `ARTIFACT_MAX_ENTRIES` files is refused, and refused before its
      contents are fetched rather than after.
- [ ] A folder whose declared size exceeds `ARTIFACT_MAX_UNCOMPRESSED_BYTES` is refused on the same
      terms.
- [ ] An empty folder is refused with a message saying so.

### What the writer is told

- [ ] A repository or folder their GitHub account cannot see says exactly that, and mentions their
      GitHub access — it is the likely cause and they can act on it.
- [ ] A rejected or expired token tells them to sign in with GitHub again.
- [ ] These messages are deliberately specific, unlike an external login's refusal: the caller is an
      authenticated writer acting on their own access, so naming the cause reveals nothing they do
      not already know and is what lets them fix it.

### Invariants that must not drift

- [ ] Publishing from a public repository still works for a writer who has never signed in with
      GitHub, and still runs anonymously in the browser.
- [ ] No GitHub token ever reaches the browser, in a response body or anywhere else.
- [ ] The import never writes to GitHub. Every request it makes is a `GET`.
- [ ] `docs/data-model.md` and `docs/openapi.json` are updated to match. CONTEXT.md needs no change:
      importing is a way of supplying a Skill's files, not a new domain term.

## Out of scope

- Re-fetching or syncing a published Skill against the repository it came from. This stays a
  one-time import, as it is for public repositories.
- Browsing a repository's directory tree in the interface to find the folder. The writer supplies
  the URL from GitHub's own UI.
- The CLI. `skillreg` publishes from a local folder and is unaffected.
- A ref whose name contains `/`, which `parseGitHubSkillUrl` already rejects.
- ~~Encrypting stored OAuth tokens.~~ Done here after all, rather than deferred: the column it
  protects is the one this change introduces, so leaving it plain text until a follow-up was the
  worse trade. ADR-0020 records the reversal.
- Any org-level or per-repository allowlist for what may be imported. What a writer can read, they
  can import.
