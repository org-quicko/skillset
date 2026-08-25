# Publish a Skill from a GitHub URL

Status: ready-for-agent

## Problem Statement

Publishing a Skill today means having its folder on the machine in front of the browser —
dragged onto the publish screen or picked from a file dialog (ticket 04). A Skill that already
lives in a GitHub repository has to be cloned or downloaded locally first, just to be handed
straight back to the same drop zone. For a team that keeps its Skills in version control — its
own, or a public one it wants to adopt from — that detour is pure friction: the files are already
sitting at a URL, and the writer just wants to paste it in.

## Solution

The publish screen gains a second way to supply a Skill's files alongside the existing drop zone:
a GitHub URL field. A writer pastes either a repository's URL (`https://github.com/owner/repo`) or
GitHub's own folder-browsing URL for a subdirectory within one
(`https://github.com/owner/repo/tree/<ref>/<path>`), and the Registry fetches that folder's
contents straight from GitHub and feeds them into the exact same publishing pipeline a dropped
folder already goes through — the same client-side validation, the same Artifact build, the same
`PUT` and presigned upload. Only **public** repositories are supported, fetched anonymously
through GitHub's REST API; there is no server involvement and no GitHub credential anywhere in the
Registry (ADR-0010).

## User Stories

1. As a writer, I want to paste a GitHub repository URL and publish it as a Skill, so that I don't
   have to clone it locally first just to drag it back in.
2. As a writer, I want to paste a URL to a subdirectory of a repository, so that I can publish one
   Skill out of a repo that holds several.
3. As a writer, I want a URL that isn't shaped like a GitHub repository or folder link rejected
   immediately with a clear reason, so that I know to fix the URL rather than wait on a request
   that was never going to work.
4. As a writer, I want the same frontmatter and structural validation a dropped folder gets —
   name, description, `SKILL.md` at the root, entry and size limits — so that a Skill fetched from
   GitHub can't reach the Registry held to a lower bar than one dragged in by hand.
5. As a writer, I want a clear message when the repository doesn't exist, is private, or GitHub
   rate-limits the request, so that I know it's not something wrong with my Skill.
6. As a writer, I want publishing from a URL to replace an existing Skill of the same name exactly
   as a dropped folder does, so that the two ways of supplying files stay interchangeable.

## Implementation Decisions

### URL parsing

- A new pure function, `parseGitHubSkillUrl`, in `packages/shared` (`src/github.ts`), alongside
  the other shared validation rules — table-driven-tested the same way `skill-rules.ts` already is.
- Accepted shapes, `https://github.com/` only:
  - `https://github.com/<owner>/<repo>` (optionally with a trailing slash or a `.git` suffix on
    `<repo>`) — the repository root, on its default branch.
  - `https://github.com/<owner>/<repo>/tree/<ref>` or `https://github.com/<owner>/<repo>/tree/<ref>/<path...>`
    — GitHub's own folder-browsing URL shape, with or without a subdirectory. `<ref>` is a branch
    or tag name with no `/` in it (a ref containing `/` is out of scope — see below) or a commit
    SHA. With no `<path...>`, this is the repository root pinned to that ref rather than the
    default branch.
- Any other shape — a different host, a `blob` URL (a single file, not a folder), a bare
  `owner/repo` with no scheme, a `tree` URL with no ref at all (`.../tree` or `.../tree/`) — is
  rejected before any network call, with a message naming what was expected.
- Returns `{ owner, repo, ref: string | null, path: string }`; `ref` is `null` for the bare
  repository-root shape and resolved to the default branch by the caller.

### Fetching

- A new function, `fetchGitHubSkillFiles(url: string): Promise<SkillFile[]>`, in
  `apps/web/src/lib/read-github-files.ts` — network glue over `parseGitHubSkillUrl`, in the same
  place and at the same (untested) seam as `read-skill-files.ts`'s existing `readDroppedFiles` and
  `readPickedFiles` (spec, master "Testing Decisions": "The web interface gets no seam of its
  own").
- When `ref` is `null`, one call to `GET https://api.github.com/repos/{owner}/{repo}` resolves
  `default_branch`.
- The folder is walked with GitHub's Contents API,
  `GET https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={ref}`, recursing into
  every `type: "dir"` entry. Every `type: "file"` entry's bytes are fetched from its own
  `download_url` (`raw.githubusercontent.com`, which serves CORS-enabled anonymous responses) —
  not decoded from the Contents API's inline `content` field, which GitHub omits or truncates past
  1 MiB. Entries of any other `type` (`symlink`, `submodule`) are dropped, the same way excluded
  paths already are.
- Every fetched file becomes a `SkillFile` whose `path` is its location relative to the resolved
  folder (`path/to/skill/SKILL.md` becomes `SKILL.md`), so the result is shaped exactly like what
  `readDroppedFiles` already produces and needs no changes downstream.
- All of this reuses the existing `buildSkillBundle` → `PUT /skills/{name}` → presigned-upload
  pipeline unchanged. No API route, no CLI, and no server-side code changes.
- Failure messages are told apart by what GitHub actually said: a 404 means the repository or path
  doesn't exist or isn't public; a 403 with a zero rate-limit header means anonymous requests are
  exhausted for the hour; anything else is a generic network failure. Each gets its own plain,
  writer-facing sentence — none of this reuses `SkillValidationError`, which is specifically for
  `SKILL.md` content rules, not URL or transport failures.

### Web interface

- `publish-skill-form.tsx` gains a second block below the existing drop zone: a labelled text
  input for the URL and a "Publish from URL" button, disabled while empty or while a publish is
  already in flight.
- Submitting calls `fetchGitHubSkillFiles`, and on success hands the result to the same
  `handleFiles` the drop zone and file-picker paths already call — so from that point on a
  GitHub-sourced Skill is indistinguishable from a dropped one: same validation failures, same
  upload-failure message, same success handling.
- A failure from `fetchGitHubSkillFiles` (bad URL shape, repo not found, rate-limited, network
  error) is shown the same way a dropped folder's read failure already is today — it happens
  before the publish mutation is invoked, so it can't live on the mutation's own error state.
- No new shadcn component is introduced; the field uses the existing `Input` and `Button`.

## Testing Decisions

**`parseGitHubSkillUrl`** is a pure function and is tested table-driven in `packages/shared/test`,
the same way `skill-rules.ts`'s validators already are: one case per accepted shape (root, root
with trailing slash, root with `.git`, `tree` URL with a nested path, a SHA as `ref`) and one per
rejected shape (wrong host, `blob` URL, no scheme, `tree` with no path, empty string).

`fetchGitHubSkillFiles` is not independently tested, consistent with the master spec's stance that
the web interface gets no seam of its own — it is network glue over an already-tested parser and
an already-tested publishing pipeline, exactly the same trade-off already accepted for
`readDroppedFiles` and `readPickedFiles`, which also have no tests today.

## Out of Scope

- Private repositories, and any GitHub credential (personal access token, GitHub App, OAuth) to
  reach one. Only anonymous access to public repositories is supported.
- A ref (branch, tag) whose name itself contains a `/`. GitHub's own folder-browsing URL is
  ambiguous between the ref and the path in that case; a writer with such a branch can still
  publish by downloading the folder and dragging it in.
- The CLI. `skillreg` tickets 06/07 are unbuilt and unaffected by this effort.
- Any server-side or API change. Fetching happens entirely in the browser, exactly like a dropped
  folder's files already do.
- Re-fetching or syncing a published Skill against the URL it came from. This is a one-time import,
  not a link — publishing again means pasting the URL again, same as re-dragging a folder.
- Any UI for browsing a repository's directory structure to help a writer find the right URL. The
  writer supplies the URL themselves, from GitHub's own UI.

## Further Notes

Why this is entirely client-side and public-repo-only, rather than a server-side fetch that could
also support private repos with a stored credential, is recorded in
`docs/adr/0010-github-fetch-is-client-side-and-public-only.md`.
