# Importing from GitHub is its own capability

Spec for ADR-0023. Splits the GitHub Integration's two capabilities — Sign-in and Import — so each
has its own switch, its own consent, and its own revocation.

## Problem Statement

There is one switch for GitHub, and it governs two unrelated things.

An Admin turns GitHub off because nobody should sign in with it — the company is on Google
Workspace, and a second front door is a second thing to audit. The moment they do, every writer
loses the ability to publish a Skill from a private GitHub repository, which has nothing to do with
how anyone logs in. The Registry tells them the import failed because *"GitHub sign-in is not
enabled"*, which is true and useless: the remedy is to re-open a login nobody wanted.

The same coupling runs the other way, and it costs more. Because the import credential is collected
at login, the `repo` scope is requested from *everyone* who signs in with GitHub — a reader who only
browses Skills hands the Registry read **and write** access to every private repository they can
reach, and is never asked about importing anything. An operator who wants the login convenience
cannot decline that. There is also no way to find out who has granted it; the answer exists only in
`psql`.

Underneath both symptoms is one thing: signing in and granting repository access are the same act,
so they cannot be configured, consented to, or revoked separately.

## Solution

The GitHub Integration keeps one OAuth application and one credential pair, and offers two
capabilities that switch on independently.

**Sign-in** is unchanged in every respect except its scopes: `read:user`, `user:email`, `read:org`.
`repo` is gone from it, and its access token is no longer stored, because nothing reads it.

**Import** becomes something a writer opts into. They connect GitHub deliberately, from settings,
and that grant — a **Connection** — is what the Registry reads a private repository as. It is
separate from their login: a writer who signs in with Google can hold one, a writer who signs in
with GitHub can connect a different GitHub account, and disconnecting never affects their ability to
sign in.

An Admin gets two toggles instead of one. Sign-in stays in Identity Providers; Import lives in a new
Integrations section on the same settings page. All four combinations are legitimate deployments,
and publishing from a *public* repository keeps working through the browser's anonymous fetch even
with both off.

## User Stories

### The Admin configuring the Registry

1. As an Admin, I want to turn GitHub sign-in off without breaking imports, so that my people can go
   on publishing from private repositories while authenticating through Google.
2. As an Admin, I want to turn GitHub import off while leaving sign-in on, so that the Registry
   offers a convenient login without holding a private-repository credential for anybody.
3. As an Admin, I want to enable Import on a Registry that never had GitHub sign-in, so that I can
   adopt the feature without opening a login I do not want.
4. As an Admin, I want the Import toggle in a section that is plainly not about identity, so that I
   am not led to believe I am configuring a way to log in.
5. As an Admin, I want both toggles to read from the one credential pair I already entered, so that
   I do not register a second application with GitHub.
6. As an Admin, I want turning Import off to take effect on the very next import rather than on the
   next restart, so that the switch means what it says when I flip it.
7. As an Admin, I want turning Import off to leave existing Connections in place, so that turning it
   back on does not make every writer reconnect.
8. As an Admin, I want to see which Users hold a Connection, so that I can answer "who has granted
   this Registry access to our private repositories" without opening a database client.
9. As an Admin, I want a demoted writer's Connection cleared automatically, so that a credential
   does not outlive the role that justified it.
10. As an Admin, I want the Registry to stop asking every person who logs in for `repo` access, so
    that readers stop granting something they will never use.

### The writer publishing a Skill

11. As a writer, I want to connect my GitHub account from settings, so that I can import Skills from
    private repositories without that being bundled into how I log in.
12. As a writer signed in with Google, I want to connect GitHub for import, so that my company's
    choice of login does not determine where I can publish from.
13. As a writer signed in with GitHub, I want to connect a *different* GitHub account for import, so
    that my personal login and my work repositories can be separate accounts.
14. As a writer, I want to be shown exactly what I am granting before I connect, so that handing over
    private-repository access is a decision rather than a side effect.
15. As a writer, I want to see whether I am currently connected and which GitHub account it is, so
    that I can tell why an import can or cannot see a repository.
16. As a writer, I want to disconnect GitHub import, so that I can withdraw repository access when I
    no longer need it.
17. As a writer whose only login is GitHub, I want disconnecting import to leave my sign-in intact,
    so that revoking repository access cannot lock me out.
18. As a writer, I want to be told plainly that disconnecting stops *this Registry* using the grant
    rather than withdrawing it at GitHub, so that I know to visit GitHub if I want it gone entirely.
19. As a writer who linked GitHub before this change, I want to be asked to connect once, so that
    nobody is silently treated as having consented to something they were never offered.
20. As a writer, I want an import that fails because I am not connected to say so and offer the
    connect action, so that the remedy is one click and mine to take.
21. As a writer, I want an import that fails because an Admin turned Import off to say *that*, so
    that I go and ask an Admin instead of reconnecting pointlessly.
22. As a writer, I want an import that fails on an expired or revoked grant to tell me to
    *reconnect*, so that I am not sent to sign in again, which no longer refreshes anything.
23. As a writer, I want to import from any repository my connected GitHub can read, so that the
    convenient path is not narrower than cloning the repository and uploading the folder.
24. As a writer, I want to publish from a *public* repository with no Connection at all, so that the
    feature works on a Registry where GitHub is configured for nothing.

### The reader

25. As a reader, I want signing in with GitHub to ask only for my identity, so that browsing a
    Registry does not cost me write access to every private repository I can reach.
26. As a reader, I want no connect action offered to me, so that I am not invited to grant a
    credential I could never use.

### The operator running the deployment

27. As an operator, I want the Registry to hold no GitHub access token for anyone who has not
    connected, so that a leaked backup is not a leaked repository credential for my whole team.
28. As an operator, I want the set of `repo`-capable tokens to be exactly the set of Connections, so
    that the blast radius is something I can enumerate.
29. As an operator, I want the ADR to record honestly that disconnecting is Registry-local, so that I
    do not tell my security reviewer something untrue.

## Implementation Decisions

### Schema

A single new column, `identity_providers.import_enabled`, boolean, not null, default false. It is
meaningful only on the `github` row. The column lives here rather than in its own table because the
credential pair it depends on lives here, and one row per application beats a join to avoid two
dead booleans on the `google` and `microsoft` rows. Its comment must say so.

`enabled` keeps its exact current meaning — Sign-in — so `/auth/providers`, `listEnabled`, and
`socialProvidersFor` are untouched.

No consent column. A Connection is an `accounts` row with `provider_id: "github-import"`, and its
existence *is* the consent; `created_at` is when it was given. The existing unique index on
`(provider_id, issuer, account_id)` already permits a User to hold both a `github` sign-in row and a
`github-import` row.

No migration backfills `import_enabled` to true. An operator turns it on deliberately, which is the
first time anyone has decided the two capabilities separately.

### Authentication

`GITHUB_SCOPES` loses `repo`, keeping `read:user`, `user:email`, `read:org`.

Better Auth's `genericOAuth` plugin registers a second provider, `github-import`, against the same
`client_id`/`client_secret` from the `github` row, requesting `repo`. It is configured when
`import_enabled` is set, independently of `enabled` — which is why the Connection flow needs no
special-casing when Sign-in is off: it does not travel through `socialProviders` at all.

`createAuthRegistry`'s version key already covers the whole `identity_providers` table via row count
and latest `updated_at`, so toggling `import_enabled` rebuilds the instance with no change to that
mechanism.

The sign-in account row's access token is not persisted. Nothing reads it after this change, and for
anyone who granted `repo` before it, GitHub will keep returning a `repo`-capable token regardless of
what is requested — scopes on an OAuth application accumulate and re-authorization auto-completes
with the union. Storing it would mean holding an encrypted copy of a credential nobody can use.

The organisation gate does not run on a `github-import` authorization. It runs on `create-user`,
`link-account`, and `sign-in` for identity providers as it does today; the Connection flow is
excluded. Permitted Organisation is defined as the control on who gets an account, and a Connection
creates none.

### Import service

`GitHubImportService` stops reading the login flag. Its precondition becomes `import_enabled` on the
`github` row, read per import so the switch is immediate (ADR-0019), and a missing row is still
treated as off. The token comes from the `github-import` account row; absence of that row is
"not connected", which is what makes a pre-change link correctly read as unconnected without
inspecting `accounts.scope`.

Everything ADR-0020 decided about the fetch itself is unchanged: the request is built from
`{ owner, repo, ref, path }` and never from a caller-supplied URL, redirects are not followed, the
per-file `download_url` is checked against `raw.githubusercontent.com`, and the walk is
`readGitHubFolder` in shared.

The `unauthorized` failure message changes from *"Sign in with GitHub again to refresh the
Registry's access"* to wording that says reconnect. That advice became wrong the moment the import
token stopped coming from the login.

### API surface

`POST /github/skill-files` keeps its `writer` requirement, its body shape, and its response shape.
Only the preconditions behind it change.

A connect route and a disconnect route, both `writer`-gated. Disconnect deletes the `github-import`
account row and nothing else.

`PATCH /identity-providers/:id` and `POST /identity-providers` accept `import_enabled`.
`IdentityProviderSchema` gains it; `PublicIdentityProviderSchema` does **not** — that shape is
unauthenticated and describes login buttons.

The Users list response gains a boolean for whether that User holds a Connection.

A shape for the current User's own Connection: whether one exists, and the connected GitHub account
login. Never the token.

### Refusal codes

`github_login_disabled` becomes `github_import_disabled`. `github_not_connected` covers both a User
who never connected and one whose only GitHub row predates the change, because the remedy is the
same click. Both remain in the browser's `SENT_NO_TOKEN` set so the anonymous public-repository
fallback still fires for them, and for nothing else.

### Role changes

Dropping a User below `writer` clears their Connection, in the same operation that changes the role.

### Web

Settings page, existing role-gating pattern. A Connection card beside `tokens-card`, visible to
`writer` and above: connected state, the GitHub account login, connect and disconnect actions, and
copy that says disconnecting stops the Registry using the grant rather than withdrawing it at
GitHub. An Integrations section beside `identity-providers-card`, Admin only, holding the Import
toggle. A Connection column on the Users card.

## Testing Decisions

A good test here asserts on behaviour the Registry is responsible for, through a boundary a caller
actually crosses. It does not reach into a service to check that a private method ran, and it does
not test GitHub — a real round trip would be testing someone else's server. Where a stubbed GitHub
is the only way to reach a branch, the stub is injected at the existing `fetchImpl` parameter rather
than by monkey-patching a global.

No new seams. Prior art for every one of these is already in the repo.

**Seam 1 — the API request boundary.** The existing seam from `test/setup.ts`: no server listens,
`app.request(...)` runs against a real Postgres in a container and the fake storage adapter. Prior
art is `github-import.test.ts`, `identity-providers.test.ts`, and `users.test.ts`. Covers:

- All four combinations of `enabled` and `import_enabled`, and that each governs only its own
  capability — in particular that import works with Sign-in off, and is refused with Sign-in on and
  Import off.
- `writer` required to import, to connect, and to disconnect; a reader refused at each.
- The two refusal codes, each on its own precondition.
- A Connection is a `github-import` account row; disconnect removes it and leaves the `github`
  sign-in row present.
- A User holding only a `github` row reads as not connected — the pre-change case.
- A demotion below `writer` clears the Connection.
- A GitHub sign-in stores no access token.
- `import_enabled` round-trips through create and patch, and is absent from the unauthenticated
  provider list.
- The Users list reports Connection state.
- A change to `import_enabled` takes effect on the next import with no restart.

**Seam 1, service driven directly.** The documented sub-case at `github-import.test.ts:30`, for
branches only a stubbed GitHub reaches — chiefly that a 401 or 403 produces the reconnect wording
rather than the sign-in wording.

**Seam 0 — configuration.** `auth-schema.test.ts`, which exists because a Better Auth field mapped
to a column that does not exist fails far away rather than loudly; the `accounts.issuer` incident is
recorded in its own docblock. Add an assertion that the `genericOAuth` provider is registered and
its fields land on columns that exist.

**No web seam,** following the precedent set in `.scratch/skill-analytics/spec.md`: the cards and
the toggle are glue over a contract Seam 1 already proves, and the repo has no browser harness.

## Out of Scope

**A GitHub App.** Rejected in ADR-0023: its user access tokens are fine-grained, and `GET /user/orgs`
returns an empty list for those, so the ADR-0018 login gate would refuse every sign-in. Rebuilding
the gate on `GET /user/installations` would make signing in depend on an owner installing the app —
a worse coupling than the one being removed.

**A second application** — an OAuth App for sign-in and a GitHub App for import. Strictly the best
security outcome and explicitly the option to move to later, rejected here on setup burden for a
self-hosted operator. Nothing in this spec makes that move harder.

**Revoking the `repo` grants existing users already gave at GitHub.**
`DELETE /applications/{client_id}/grant` withdraws the whole authorization, so everyone would face a
consent screen at their next sign-in to clean up a grant the Registry no longer holds a token for.
The grants linger until each person clears them; not storing the login token is the mitigation, and
it is a partial one.

**An allowlist of importable owners or organisations.** A writer can import from anything their
connected GitHub can read. Publishing already requires a role an Admin granted, and the same writer
can clone the repository and upload the folder — an allowlist would close the convenient path and
leave the manual one open.

**Requiring a Connection to match the login identity.** It follows from not gating the Connection:
if the connecting account is not judged as an identity, it need not be the identity.

**Merging the browser's anonymous fetch with the server-side path.** They stay separate, as
ADR-0020 decided; the walk is already shared via `readGitHubFolder`, so only credential handling
differs.

**Any change to Google or Microsoft.** `import_enabled` is inert on those rows.

## Further Notes

The domain terms are in `CONTEXT.md`: **GitHub Integration** for the Registry's single registration
with GitHub, and **Connection** for a writer's own grant of repository access. Use them in code,
copy, and commit messages. A Connection is not a "link" and not a "linked account" — those name the
sign-in row.

ADR-0023 is the decision record and carries the reasoning behind every rejection above. ADR-0020
carries a superseded-in-part banner; its sections on running as the caller, the request-forgery
surface, and encryption at rest still govern and are not reopened here.

The honesty constraint is load-bearing and easy to lose in review: disconnecting is Registry-local.
If the Connection card says "revoked" without qualification, the product and the ADR disagree, and
the ADR is right.
