# Generic source layer in shared

## What to build

Make the reading generic across Git Providers. Today `parseGitHubSkillUrl`, `GitHubSkillLocation`,
`readGitHubFolder`, and `GitHubFolderError` are GitHub-shaped from top to bottom, so a second provider
means writing all of it again. This ticket generalises them and adds GitLab.

A **data table, not polymorphism.** One `Record<string, ProviderConfig>` in `packages/shared`; no
interfaces, no classes per provider, no registry. Adding a provider is a key in that record.

```ts
interface SkillSourceLocation {
  provider: string;          // "github" | "gitlab" — validated against the config table
  project: string;           // "owner/repo", or "group/subgroup/project"
  ref: string | null;        // null resolves the default branch
  path: string;              // folder within the project, "" for its root
}

interface ProviderConfig {
  apiBase: string;                    // pinned constant; never operator-supplied (cloud only)
  rawHost: string | null;             // allowlisted host for file bytes, where separate
  urlPatterns: RegExp[];
  minProjectSegments: number;
  maxProjectSegments: number | null;  // null = unbounded, for GitLab nested groups
}
```

**`project` is a path, not an owner and a repo.** GitLab has nested groups:
`gitlab.com/acme/platform/tooling/skills` is one project four segments deep. So `project` permits
`/`, which `GITHUB_NAME_PATTERN` was written to forbid — and the traversal defence therefore *moves*
rather than weakens. ADR-0020's guarantee is unchanged: no caller-supplied value may move a request to
another host or another API route.

The two walks genuinely differ and should not be forced into one shape. GitHub recurses the Contents
API one call per directory and fetches bytes from `raw.githubusercontent.com`. GitLab's tree API takes
`recursive=true`, so one listing call serves the whole folder, and bytes come from the same API host.
What is shared is the reasons, the limits, and the error type.

## Acceptance criteria

### Parsing

- [x] `parseSkillSourceUrl(url)` returns a `SkillSourceLocation` including which provider the URL
      names, or throws with a message naming what was expected. No network call.
- [x] GitHub shapes accepted: bare repository root (optional trailing slash, optional `.git`), and
      `/tree/<ref>` and `/tree/<ref>/<path...>`.
- [x] GitLab shapes accepted: bare project root, and `/-/tree/<ref>[/<path...>]`, including a project
      under nested groups.
- [x] Rejected before any request: a host that is neither provider, a host that merely looks like
      one (`github.com.evil.example`), a `blob` or `raw` URL, a bare `owner/repo` with no scheme, a
      `tree` URL with no ref, a GitHub project with a third segment, a GitLab project with only one,
      and an empty string.
- [x] A ref whose name contains `/` is **not** rejected and cannot be: a provider's browse URL is
      genuinely ambiguous between the ref and the folder path, so `.../tree/release/1.0/skills`
      parses as ref `release` and path `1.0/skills`. Same as the behaviour it replaces; documented
      on `parseSkillSourceUrl` rather than pretended away.
- [x] Table-driven tests in `packages/shared/test`, one case per accepted and per rejected shape per
      provider — the way `skill-rules.ts` and `github.ts` are already tested.

### Validation

- [x] A `project` validator, tested on its own: every segment must match `^[A-Za-z0-9._-]+$` and be
      neither `.` nor `..`; the whole must not start or end with `/`, and must not contain an empty
      segment.
- [x] Segment count is checked against the provider's `minProjectSegments`/`maxProjectSegments`, so
      GitHub is pinned to exactly two and GitLab is not.
- [x] Encoded traversal (`%2e%2e`, `..%2f`) is rejected. Decode before validating, or reject any
      percent-encoding — either is fine, but a test must prove it.
- [x] `ref` is still held to `^[A-Za-z0-9._-]+$`.

### Reading

- [x] `readSkillFolder(location, options)` dispatches on `location.provider` and returns
      `SkillFile[]` at paths relative to the folder the location names — identical in shape to what
      `readDroppedFiles` produces, so nothing downstream changes.
- [x] `SkillFolderError` carries the same reasons `GitHubFolderError` does today. Callers keep owning
      their own wording: the API's sentences address a signed-in writer, the browser's a reader with
      no credential.
- [x] The GitHub walk behaves exactly as it does now, including dropping `symlink` and `submodule`
      entries and fetching bytes only from an allowlisted `rawHost`.
- [x] The GitLab walk uses `recursive=true` and drops non-blob entries.
- [x] `null` ref resolves the project's default branch, per provider.
- [x] Entry-count and uncompressed-size limits are refused **before** contents are fetched, not
      after. An empty folder is refused with a message saying so.
- [x] Redirects are not followed on any request.
- [x] `apiBase` is a constant in the config table. Nothing reads it from configuration or from a
      caller — self-hosted instances are out of scope by ADR-0024, and this is the property that
      keeps request forgery closed.
- [x] An optional token is sent as `Authorization: Bearer` when supplied, and omitted for an
      anonymous read.
- [x] Existing call sites keep working: `apps/web/src/lib/read-github-files.ts` and
      `apps/api/src/services/github-import.ts` compile and their tests pass.

## Blocked by

Nothing.

---
GitHub: #33
Spec: `.scratch/github-import/spec.md`
ADR: `docs/adr/0024-import-is-a-github-app-and-login-stays-an-oauth-app.md`,
`docs/adr/0020-private-repo-import-runs-server-side-as-the-caller.md` (request-forgery surface)
