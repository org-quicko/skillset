# Import route, running on Connections

## What to build

Replace `POST /github/skill-files` with `POST /imports/:provider/skill-files`, running on a
Connection rather than on the token a GitHub login left behind. This is the ticket where the old
credential path stops being used.

Body is `{ project, ref, path }` — **parts, never a URL**, exactly as ADR-0020 requires, so the route
cannot be pointed at another host. Preconditions in order: an Integration row for `:provider`, then a
Connection for this caller.

The refusal codes carry **no `github_` prefix**, because the route is generic:

| Code | Cause | What it must tell the writer |
|---|---|---|
| `integration_not_configured` | no Integration row | an Admin's problem, and says so |
| `not_connected` | no Connection | offers the connect action |
| `connection_expired` | refresh refused, or refresh token expired | **reconnect** — never "sign in again" |
| `app_not_installed` | 404, and `GET /user/installations` finds no installation for the owner | names the owner, links the install URL |

`app_not_installed` is the one worth care. A writer who is not an organisation owner **cannot**
install the app: GitHub records a request for an owner to approve, and surfaces that state to us only
as a 404. Without this diagnosis, "an owner has not approved your installation request" is
indistinguishable from a typo in the URL.

## Acceptance criteria

- [x] `POST /imports/:provider/skill-files` requires `writer`, takes `{ project, ref, path }`, and
      returns files shaped as the current route does, so `buildSkillBundle` → `PUT /skills/{name}` →
      presigned upload is untouched.
- [x] The import uses the calling writer's own Connection and nobody else's.
- [x] `:provider` with no Integration row raises `integration_not_configured`, checked before the
      Connection is so much as selected.
- [x] A caller with no Connection raises `not_connected`.
- [x] The Connection is read from the database on each import, so disconnecting or reconnecting takes
      effect on the very next attempt.
- [x] The access token is decrypted before it reaches the provider, and refreshed first when stale.
- [x] A 404 triggers `GET /user/installations`; no installation for the project's owner yields
      `app_not_installed` naming that owner and carrying the install URL. An installation that *does*
      exist yields the plain not-found message instead.
- [x] A 401 or 403 from the provider yields `connection_expired` with reconnect wording. A test
      pins it: the message must not say "sign in", which became wrong the moment the token stopped
      coming from the login.
- [x] That message also names the app's permissions as a second possible cause, and a test pins
      that too. A 403 can mean the grant is spent *or* that an Admin configured the app without
      `contents: read`, and the walk collapses both into one reason — so "reconnect" alone would
      send a writer round the same loop indefinitely while nobody learns the real cause.
- [x] Every validation rejection happens **before** any outbound request: `project` segments of `.`,
      `..`, empty, `%2e%2e`, a leading or trailing slash, and a three-segment `project` for GitHub.
- [x] Entry-count, size, and empty-folder limits are refused as they are today.
- [x] Every request the **walk** makes is a `GET`, and nothing the import does writes to a
      repository.

      Amended from "every request it makes is a `GET`", which is not quite true and should not be
      claimed. A stale access token is refreshed on the way in, and that refresh is a `POST` to the
      provider's token endpoint. It writes nothing — it exchanges a refresh token — but it is a
      `POST`, so the narrower claim is the honest one and is what the test asserts.
- [x] `POST /github/skill-files` is gone. `GitHubLoginDisabledError` and the `github_login_disabled`
      code are deleted, along with `GitHubImportService`'s read of the sign-in account's token.
- [x] Import works with GitHub **sign-in disabled**, and a GitHub sign-in works with **no
      Integration** — the two capabilities, proven independent in both directions. This is the
      acceptance criterion the whole effort exists for.
- [x] A reader is refused.
- [x] Refusals are split by whose fault they are, which the ticket did not ask for and should
      have: `import_rejected` (**422**) for a folder the caller named badly — empty, missing at that
      ref, or past an Artifact's ceilings — and `import_failed` (**502**) only for a genuine upstream
      failure. Reporting a mistyped URL or an oversized directory as 502 invites a retry that can
      never succeed and puts ordinary user error into a deployment's server-error rate.
- [x] `docs/openapi.json` updated.

## Blocked by

- 02 — Connections and the connect flow
- 03 — Generic source layer in shared

---
GitHub: #35
Spec: `.scratch/github-import/spec.md`
ADR: `docs/adr/0024-import-is-a-github-app-and-login-stays-an-oauth-app.md`
API: `docs/openapi.json`
