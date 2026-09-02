# Import a Skill from a Git Provider

Status: ready-for-agent

Decided in ADR-0024. Supersedes `.scratch/github-private-import/spec.md` and
`.scratch/github-import-capability/spec.md`, both of which describe credentials that will not exist.

## Problem Statement

Importing a Skill from a private GitHub repository works today, and it works by spending a credential
nobody meant to grant. `GITHUB_SCOPES` asks every person who signs in with GitHub for `repo` — read
**and write** across every private repository they can reach — and `GitHubImportService` reads the
token that login left behind. A reader who only browses the catalogue hands over write access to
their employer's entire private estate and is never asked about importing anything.

Three things follow, and all three are the same fault seen from different sides. An Admin who turns
GitHub sign-in off to close a second front door also stops every writer publishing from a private
repository, and is told the import failed because *"GitHub sign-in is not enabled"* — true, and
useless. An operator cannot enumerate the blast radius of their own database, because the set of
`repo`-capable tokens is "everyone who ever logged in". And a writer signed in with Google cannot
import at all, however much repository access they personally have.

Meanwhile the import is GitHub-shaped from top to bottom — `parseGitHubSkillUrl`, `readGitHubFolder`,
`GitHubImportService`, `POST /github/skill-files` — so a second Git Provider means writing all of it
again.

## Solution

Signing in and granting repository access become two registrations, two consents, and two
revocations.

**Sign-in** keeps the OAuth App, and loses `repo`. It asks for `read:user`, `user:email`, `read:org`
and nothing else, and its access token stops being stored, because nothing reads it.

**Import** gets a **GitHub App**, registered separately, granting `contents: read` on repositories an
organisation owner selected. A writer connects it deliberately from settings; that grant is a
**Connection**, and it lives in its own table rather than in the authentication tables, because
nobody signs in by connecting. Connecting is one trip: GitHub's installation page handles repository
selection and user authorization together.

Import is available for exactly those Git Providers that have an **Integration** row. There is no
Admin toggle: an operator who wants no repository credentials in the database does not create the
row.

Around that, the reading is made generic. URL parsing and the public folder walk are keyed on a
provider string and cover GitHub and GitLab, so a third provider is a table row and a URL pattern.
The credentialed path stays GitHub-only, deliberately — a GitHub App has no GitLab equivalent.

## User Stories

### The writer

1. As a writer, I want to connect GitHub from settings, so that granting repository access is a
   decision I make rather than a side effect of logging in.
2. As a writer signed in with Google, I want to connect GitHub and import, so that my company's
   choice of login does not decide where I can publish from.
3. As a writer, I want to see exactly what I am granting before I connect, and to which GitHub
   account, so that I can tell later why an import can or cannot see a repository.
4. As a writer, I want to pick which repositories the Registry may read, so that connecting does not
   hand over everything I can reach.
5. As a writer, I want to disconnect, so that I can withdraw repository access when I no longer need
   it.
6. As a writer whose only login is GitHub, I want disconnecting to leave my sign-in working, so that
   withdrawing repository access cannot lock me out.
7. As a writer, I want to be told plainly that disconnecting stops *this Registry* using the grant
   rather than withdrawing it at GitHub, so that I know to visit GitHub if I want it gone entirely.
8. As a writer, I want to paste a private repository's URL into the field I already use and have it
   publish, so that connecting buys me something in the flow I already know.
9. As a writer, I want an import that fails because I have not connected to say so and offer the
   connect action, so that the remedy is one click and mine to take.
10. As a writer, I want an import that fails because nobody installed the app on that repository's
    owner to say *that*, and name the owner, so that I do not spend an afternoon checking the URL for
    typos.
11. As a writer who is not an organisation owner, I want to be told my installation is awaiting an
    owner's approval, so that I know to go and ask a person.
12. As a writer, I want an import that fails on an expired grant to tell me to *reconnect*, so that I
    am not sent to sign in again, which refreshes nothing.
13. As a writer, I want to import from a public repository with no Connection at all, so that the
    feature works on a Registry where GitHub is configured for nothing.
14. As a writer, I want to paste a GitLab URL for a public project, so that a team on GitLab is not
    excluded from the one path that needs no credential.

### The reader

15. As a reader, I want signing in with GitHub to ask only for my identity, so that browsing a
    catalogue does not cost me write access to every private repository I can reach.
16. As a reader, I want no connect action offered to me, so that I am not invited to grant a
    credential I could never use.

### The Admin and the operator

17. As an Admin, I want to configure the GitHub App's credentials without a restart, the way I
    already configure an Identity Provider.
18. As an Admin, I want GitHub sign-in and GitHub import to be independent, so that turning either
    off leaves the other working.
19. As an Admin, I want to see which Users hold a Connection, so that I can answer "who has granted
    this Registry access to our repositories" without opening a database client.
20. As an Admin, I want a demoted writer's Connection cleared automatically, so that a repository
    credential does not outlive the role that justified it.
21. As an operator, I want the Registry to hold no repository credential for anyone who has not
    connected, so that a leaked backup is not a leaked repository credential for my whole team.
22. As an operator, I want the set of repository-capable tokens to be exactly the set of Connections,
    so that the blast radius is something I can enumerate.
23. As an operator, I want no repository credential held at all until I create an Integration, so
    that "we do not hold those" is a true statement I can make about a fresh deployment.

## Implementation Decisions

### A location is a project path, not an owner and a repo

`GitHubSkillLocation` is `{ owner, repo, ref, path }`, and that shape does not survive GitLab, which
has **nested groups**: `gitlab.com/acme/platform/tooling/skills` is one project four segments deep.
So the generic location is:

```ts
interface SkillSourceLocation {
  provider: string;          // "github" | "gitlab", validated against the config table
  project: string;           // "owner/repo", or "group/subgroup/project"
  ref: string | null;        // null resolves the default branch
  path: string;              // folder within the project, "" for its root
}
```

`project` therefore permits `/`, which `GITHUB_NAME_PATTERN` was written to forbid. The traversal
defence moves rather than weakens: every segment of `project` must match
`^[A-Za-z0-9._-]+$` and be neither `.` nor `..`, the whole must not start or end with `/`, and GitHub
is additionally held to exactly two segments. That keeps ADR-0020's guarantee — no value a caller
supplies can move the request to another host or another API route — while allowing a legitimately
deep GitLab path.

### Provider configuration is a data table, not an interface

One `Record<string, ProviderConfig>` in `packages/shared`, no classes and no registry:

```ts
interface ProviderConfig {
  apiBase: string;                        // pinned; never operator-supplied (ADR-0024, cloud only)
  rawHost: string | null;                 // allowlisted host for file bytes, where files are fetched
  urlPatterns: RegExp[];                  // accepted browse-URL shapes
  minProjectSegments: number;
  maxProjectSegments: number | null;      // null = unbounded (GitLab nested groups)
}
```

Adding a provider is a key in that record. `provider` is a plain string everywhere — no pgEnum, no
union type — and it is constrained by a foreign key in the database and by membership of this record
in code. Nothing hardcodes a list of provider names anywhere else.

The two walks genuinely differ and are not forced into one shape: GitHub recurses the Contents API
one call per directory and fetches bytes from `raw.githubusercontent.com`; GitLab's tree API takes
`recursive=true`, so one listing call serves the whole folder, and bytes come from the same API host.
`readSkillFolder(location, options)` dispatches on `location.provider`, and the shared reasons,
limits, and error type (`SkillFolderError`, carrying the reasons `GitHubFolderError` already carries)
are common to both.

### Schema

Two new tables. No change to `identity_providers` beyond leaving it alone.

```
integrations
  provider        text primary key                    -- "github"; matches the config table's key
  display_name    text not null
  client_id       text not null
  client_secret   text not null                       -- stored as given, per ADR-0015
  app_slug        text                                -- nullable: only GitHub has an install URL
  created_at / updated_at

connections
  id                        uuid primary key default uuidv7()
  user_id                   uuid not null references users(id) on delete cascade
  provider                  text not null references integrations(provider) on delete restrict
  external_account_id       text not null             -- the provider's own id, stable across renames
  external_account_login    text not null             -- shown in the UI so a writer can tell which account
  access_token              text not null             -- encrypted
  refresh_token             text not null             -- encrypted
  expires_at                timestamptz not null
  refresh_token_expires_at  timestamptz not null
  created_at / updated_at
  unique (user_id, provider)
```

`ON DELETE RESTRICT` on `provider` is load-bearing: removing an Integration that writers still hold
Connections against must fail loudly rather than orphan credentials. Both token columns carry a
comment saying they are ciphertext.

A migration nulls `accounts.access_token` for `provider_id = 'github'` rows. Nothing reads them after
this change, and a stored credential nothing reads is pure liability.

### The connect flow is ours

Better Auth is not involved. It models accounts and identities; a Connection is neither, and reaching
for `genericOAuth` is what pushed ADR-0023 into storing a repository credential in the
authentication table.

- `GET /connections/:provider/start` — `writer`+. Mints a `state`: random, single-use, HMAC'd with
  the auth secret, bound to the session id, five-minute expiry, held server-side so replay fails.
  Redirects to `https://github.com/apps/{app_slug}/installations/new?state=…`, which performs
  repository selection **and** user authorization in one pass.
- `GET /connections/:provider/callback` — validates and burns the `state` *before* anything else,
  exchanges the code at `https://github.com/login/oauth/access_token` with the Integration's client
  id and secret, reads the account via `GET /user`, and upserts on `(user_id, provider)` so
  reconnecting replaces. Redirects to settings. **CSRF on this route is the one thing not to get
  wrong.**
- `DELETE /connections/:provider` — `writer`+. Deletes the row and nothing else. The response copy
  must say the grant is not withdrawn at GitHub.
- `GET /connections` — `writer`+. The caller's own Connections: provider, account login, connected
  at. Never a token, in any shape, in any response.

Tokens are encrypted with Better Auth's `symmetricEncrypt` under the auth secret, matching what
`github-import.ts` already decrypts with. `isEncrypted`'s hex sniff moves across with them.

### Refresh

Read the row per import; if `expires_at` is within a minute, refresh first, then use the new token —
this is why the check is not "has it expired". A refresh that GitHub refuses deletes nothing and
raises `connection_expired`; the writer reconnects. A refresh token past
`refresh_token_expires_at` is not sent to GitHub at all.

### Import

`POST /imports/:provider/skill-files` replaces `POST /github/skill-files`, `writer`+, body
`{ project, ref, path }` — parts, never a URL, exactly as ADR-0020 requires. Preconditions in order:
an Integration row for `:provider` exists, then a Connection for this caller.

The browser chooses its path on whether the writer holds a Connection, which is why `GET /connections`
is loaded by the publish screen:

| Writer | Public repository | Private repository |
|---|---|---|
| No Connection | anonymous, client-side (ADR-0010, unchanged) | fails; offers connect |
| Connection | **server-side** | server-side |

That table's one surprise is a connected writer taking the server path for a *public* repository.
Anonymous GitHub allows sixty requests an hour per IP and the walk spends roughly one per file, so a
shared office address exhausts it in two or three imports; a token has five thousand.

### Refusal codes

No `github_` prefix — the routes are generic, so the codes are:

- `not_connected` — no Connection for this provider. Offers connect.
- `connection_expired` — refresh refused or refresh token expired. Says **reconnect**, never "sign
  in again".
- `app_not_installed` — a 404 whose cause is diagnosed by `GET /user/installations` finding no
  installation for the project's owner. Names the owner and links
  `https://github.com/apps/{app_slug}/installations/new`. This covers the pending-approval case,
  where a non-owner requested installation and GitHub is waiting on an owner: the writer did
  everything right and GitHub tells us only "404".
- `integration_not_configured` — no Integration row. An Admin's problem, and says so.

`github_login_disabled` and `GitHubLoginDisabledError` are deleted.

### Roles

Dropping a User below `writer` deletes their Connections, in the same transaction that changes the
role.

### Admin configuration

`GET/POST/PATCH /integrations`, Admin-only, same shape as the identity-provider routes.
`client_secret` is write-only: no response shape includes it. Read per request, so an edit takes
effect on the next import with no restart (ADR-0019).

### Web

- A **Connection** card on the settings page beside `tokens-card`, `writer`+: connected state, the
  GitHub account login, connect and disconnect, and copy stating that disconnecting stops the
  Registry using the grant rather than withdrawing it at GitHub.
- An **Integrations** section beside `identity-providers-card`, Admin only, for the credential pair
  and app slug.
- A **Connection** column on `users-card`.
- `publish-skill-form.tsx` keeps one URL field. It parses the pasted URL to discover the provider,
  then routes per the table above, and renders `not_connected` and `app_not_installed` with their
  actions rather than as plain text.

## Testing Decisions

No new seams. Prior art for all of this is in the repo.

**Seam 1 — the API request boundary.** `test/setup.ts`: no server listens, `app.request(...)` against
real Postgres in a container and the fake storage adapter. Prior art: `github-import.test.ts`,
`identity-providers.test.ts`, `users.test.ts`. Covers:

- Import refused with no Integration row (`integration_not_configured`) and with no Connection
  (`not_connected`), each on its own precondition.
- Import works with GitHub **sign-in disabled**, and a GitHub sign-in works with **no Integration** —
  the two capabilities, proven independent in both directions.
- `writer` required to import, connect, and disconnect; a reader refused at each.
- `state` validation: a missing, tampered, expired, replayed, or other-session `state` is refused and
  no Connection is written.
- Reconnecting replaces rather than duplicating; the unique index holds.
- Disconnect removes the Connection and leaves a `github` sign-in account row intact.
- Demotion below `writer` clears Connections.
- A GitHub sign-in stores no access token, and `GITHUB_SCOPES` contains no `repo`.
- Deleting an Integration with live Connections fails; a Connection naming an unregistered provider
  cannot be inserted.
- No response body anywhere contains a token or a `client_secret`.
- A stale `expires_at` triggers refresh before the read; a refused refresh raises
  `connection_expired`; an expired refresh token is not sent to GitHub.
- Traversal and injection: `project` segments of `.`, `..`, empty, `%2e%2e`, a leading or trailing
  slash, and a three-segment `project` for GitHub are all rejected before any outbound request.
- Limits — entry count, uncompressed size, empty folder — refused before contents are fetched.
- An Integration edit takes effect on the next import with no restart.

**Seam 1, service driven directly.** The documented sub-case at `github-import.test.ts:30`, for
branches only a stubbed GitHub reaches: the 404 → `GET /user/installations` → `app_not_installed`
diagnosis, and that a 401 produces reconnect wording rather than sign-in wording. The stub goes in at
the existing `fetchImpl` parameter, never by monkey-patching a global.

**Shared, table-driven.** `packages/shared/test`, as `skill-rules.ts` and `github.ts` already are:
`parseSkillSourceUrl` over every accepted and rejected shape per provider — GitHub root, `.git`
suffix, `tree/<ref>/<path>`; GitLab `/-/tree/<ref>/<path>` including a nested group; and rejections
for a wrong host, a `blob` URL, a bare `owner/repo`, a `tree` URL with no ref, and a ref containing
`/`. Plus the `project` segment validator on its own.

**No web seam,** per the precedent in `.scratch/skill-analytics/spec.md`: the cards and the form are
glue over a contract Seam 1 proves, and the repo has no browser harness.

## Out of Scope

- **Push.** `skillreg publish --path` already publishes a folder from CI with a Token. Nothing here
  changes it. (`publish-many`, ticket 07, remains unbuilt and unrelated.)
- **Self-hosted instances** — GitLab self-managed, Gitea, Bitbucket Data Center. Cloud only. The
  `apiBase` is a pinned constant per provider precisely so no caller and no operator can point a
  request at another host; making it configuration is a security regression to take deliberately,
  with its own ADR, not as a side effect.
- **A credentialed path for GitLab.** GitLab is public-pull-only. A GitHub App has no GitLab
  equivalent, so the credential layer is explicitly per-provider rather than pretend-generic.
- **Bitbucket.** A config-table row whenever someone asks.
- **Syncing or re-fetching.** An Import is a one-time copy. A published Skill keeps no reference to
  where it came from.
- **Archive-based fetching** (`/tarball`, `/archive.tar.gz`). Considered and rejected: it would be one
  request instead of many, but the rate-limit case for it collapsed once connected writers got a
  5,000/hour token, and it would mean downloading a whole repository to keep one folder plus a tar
  reader `fflate` does not provide.
- **A GitHub App acting as its installation.** Rejected in ADR-0024: it discards "runs as the caller".
- **More than one Connection per provider per User.** Unique on `(user_id, provider)`; reconnecting
  replaces. Nothing requires the connected account to match the sign-in account.
- **An Admin-level import switch.** An Integration row is the switch.
- **Revoking the `repo` grants people have already given at GitHub.** Cannot be done without facing
  every existing user with a fresh consent screen; see ADR-0024.
- **Moving the sign-in OAuth App's credentials** out of `identity_providers`. Two tables holding
  third-party credential pairs is a documented smell, not a migration.
- **A repository browser** in the interface. The writer supplies the URL from the provider's own UI.
- **An allowlist of importable owners.** The GitHub App's installation *is* the allowlist, and an
  owner controls it.

## Further Notes

The domain terms are in `CONTEXT.md`: **Git Provider**, **Integration**, **Connection**, **Import**.
Use them in code, copy, and commit messages. A Connection is not a "link" and not a "linked account";
those name a sign-in row. An Integration is not an "app".

ADR-0024 is the decision record. ADR-0020 keeps a superseded-in-part banner — its sections on running
as the caller, on the request-forgery surface, and on encryption at rest still govern and are not
reopened. ADR-0023 is superseded and was never built; the one thing worth reading there is why
`GET /user/orgs` returns an empty list for a fine-grained token, which is why one GitHub App cannot
serve both sign-in and import.

Two honesty constraints are load-bearing and easy to lose in review. Disconnecting is Registry-local:
if the Connection card says "revoked" without qualification, the product and the ADR disagree, and the
ADR is right. And encryption at rest defends a leaked backup, not a compromised host — the client
secret is in plaintext in the same database.
