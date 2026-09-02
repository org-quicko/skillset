# Importing Uses A GitHub App, Signing In Stays An OAuth App

The Registry now holds **two separate registrations with GitHub**. Signing in keeps the OAuth App it
has always used, asking only for identity. Importing a Skill from a private repository uses a
**GitHub App**, granting `contents: read` on repositories an owner chose, and a writer grants it
deliberately as a **Connection** stored in its own table.

This supersedes ADR-0020 and ADR-0023 on how the import credential is obtained and where it lives.
ADR-0020's rulings on running as the caller, on closing the request-forgery surface, and on
encrypting the token at rest are untouched and still govern. ADR-0023 was never implemented; what
survives of it is the separation it argued for, not the mechanism it proposed.

The problem both earlier ADRs left standing is one credential. `repo` is the only OAuth scope GitHub
offers for private repository contents, and it is read **and write** across every private repository
the grantee can reach, with no per-repository narrowing. ADR-0020 requested it at login, so every
reader who signed in granted write access to their employer's entire private estate in order to
browse a Skill catalogue. ADR-0023 moved the grant to a deliberate act but kept the scope, so the
Registry's database remained a store of write credentials for its whole team.

## Considered Options

**One OAuth App, authorized a second time with `repo`.** This is ADR-0023's design and the cheapest
to build: one credential pair for an operator to register, no installation step, tokens that never
expire, and a single OAuth-shaped credential path that would extend to GitLab unchanged. It was the
option to beat and is rejected on blast radius alone. A leaked database backup under this design is
push access to every private repository every connected writer can reach — production code included.
Under a GitHub App it is read access to a handful of repositories an owner deliberately picked. Those
are not the same incident, and no amount of care with the column closes the gap.

**One GitHub App serving both signing in and importing.** The obviously attractive option: one
registration, one consent, `contents: read`, nothing duplicated. It is rejected because it breaks the
login gate, silently and later. `fetchGitHubIdentity` calls `GET /user/orgs` on every login, and
GitHub's own documentation says a fine-grained user access token receives a 200 with an empty list.
An empty list is exactly what the organisation check refuses as `oauth_app_not_approved`. So a GitHub
App login works perfectly on a deployment with no Permitted Organisations and refuses **every** login
the moment an Admin adds one — a failure in a feature nobody touched, triggered by an unrelated
setting. Rebuilding the gate on `GET /user/installations` was rejected in ADR-0023 and is rejected
again here: it makes signing in depend on an owner having installed an app, so a misconfigured
installation locks people out of the Registry rather than out of importing.

**Two OAuth Apps, one per purpose.** Separates the registrations without improving the credential:
the import grant is still `repo`. It costs the same second registration as a GitHub App and buys
strictly less.

**A GitHub App acting as its installation** rather than as the caller. Simpler — no per-writer token,
no refresh — but it discards ADR-0020's central property. Every writer would import through one
shared organisation-scoped access, so "whose access read this repository" stops having an answer, and
the install log would attribute to a person a read they could not themselves have performed.

## The two registrations

**Sign-in** is an OAuth App and is unchanged except for its scopes: `read:user`, `user:email`,
`read:org`. `repo` is gone, and the access token is no longer persisted, because nothing reads it.
Its credential pair stays on `identity_providers`.

**Import** is a GitHub App. Its credential pair lives in a new `integrations` table, one row per Git
Provider, holding `client_id`, `client_secret`, and the app's slug. Only the user-to-server web flow
is used, which needs the client id and secret and no private key — the private key exists for
installation tokens, which this design does not issue.

Importing is available for exactly those Git Providers that have an `integrations` row. This is
deliberately the *only* switch. ADR-0023's Admin-level `import_enabled` is dropped, because an
operator who wants no repository credentials in the database simply does not create the row, and a
second switch above that one would express nothing the first does not.

## Where the consent lives

A **Connection** is a row in a new `connections` table, unique on `(user_id, provider)`, holding the
connected account's identifier and its encrypted access and refresh tokens. Its existence *is* the
consent; nothing else records it. `provider` is plain text with a foreign key to
`integrations.provider` under `ON DELETE RESTRICT`, so a Connection can only ever name a Git Provider
this Registry has registered, and removing a registration that writers still hold Connections against
fails loudly rather than orphaning credentials.

The Connection is not stored in Better Auth's `accounts` table, and Better Auth does not drive the
grant. This is authorization for a third-party API and not authentication — nobody signs in by
connecting — and an auth library's account model asserts otherwise. The flow is two routes of our own
with a signed, single-use `state` bound to the session; the token exchange is a form POST.

Nothing requires a Connection's account to match the account the writer signs in with. A Connection
creates no account, so it is not judged as an identity, and the Permitted Organisation gate does not
run on it.

## Consequences

Connecting and choosing repositories are **two separate trips**. Connecting sends the writer to
`/login/oauth/authorize`; choosing repositories is a second, unrelated visit to the app's installation
page, offered as `manage_access_url` and expecting no callback.

This was originally one pass, sending the writer to the installation page to authorize and pick
repositories together. That does not work, and the correction is worth recording because the design
reads better than it behaves. GitHub mints an authorization code from the installation page **only on
a first install**. Every later visit — including every repository-access change — lands on its
update-permissions screen and redirects back with `installation_id` and `setup_action` but no code,
which GitHub documents as by design and not configurable. So a writer who had already installed the
app could never reconnect: the flow refused them for a missing code, reported as an unverifiable
`state`, which reads as a security failure and sends them to retry the thing that cannot succeed. The
authorize endpoint issues a code whether the app is installed or not, so it is the only endpoint that
can serve reconnection. Losing the single pass is the price.

Two consequences follow. The callback is reached by arrivals that are not authorizations: a Setup URL
firing after an install or a repository change carries `setup_action` and no code, and lands the writer
back in settings rather than being refused — nothing was authorized, and nothing is wrong. And an
`app_not_installed` refusal must offer the *installation* page, never the connect route: authorizing
does not install the app, so sending them there completes successfully and changes nothing about what
can be read.

A writer who is **not an organisation owner** still cannot complete an installation: GitHub records a
request for an owner to approve. That writer can perform every step correctly and still import
nothing, and GitHub surfaces the state to us only as a 404. This is why a 404 triggers a
`GET /user/installations` check and an `app_not_installed` refusal naming the owner and offering the
install link — without it, a pending approval is indistinguishable from a typo.

Repointing an Integration's `client_id` at a different app deletes every Connection held against it,
in the same transaction. Those tokens were issued to the old app's client and the new one cannot
refresh them, so leaving the rows would show a writer "connected as …" while every import failed —
the interface asserting that the remedy had already been taken. Rotating `client_secret` alone does
not clear them: a secret belongs to the app rather than to the grant, so the tokens stay valid and
dropping them would cost every writer a reconnection for nothing.

User access tokens expire after eight hours and are refreshed lazily at import time; the refresh token
lasts six months. A writer who does not import for six months must reconnect. Expiry is not switched
off, although GitHub permits it: a standing non-expiring token is the credential shape this ADR exists
to move away from, and GitHub documents the opt-out as subject to change.

Tokens are encrypted at rest with Better Auth's `symmetricEncrypt` under the signing secret. This
defends a leaked backup and not a compromised host: `client_secret` sits in plaintext in the same
database by ADR-0015's deliberate choice, and anyone who can read the environment can decrypt.

The `repo` grants already given cannot be cleaned up. `DELETE /applications/{client_id}/grant`
withdraws the whole authorization, so revoking would face every existing user with a fresh consent
screen at their next sign-in in order to tidy a grant the Registry no longer keeps a token for. They
linger in each person's GitHub authorizations until that person clears them. Not storing the login
token is the mitigation, and it is a partial one. GitHub also accumulates scopes on an OAuth App, so
anyone who granted `repo` will keep receiving `repo`-capable login tokens whatever the Registry asks
for — which is the whole reason those tokens stop being persisted.

Two tables now hold third-party credential pairs: `identity_providers` for signing in, `integrations`
for importing. Consolidating them was rejected as refactoring the authentication path as a side effect
of building an import feature, touching the auth instance registry, its version key, the provider
routes, and their schemas. A comment at both sites carries the explanation instead.

A writer holding a Connection imports through the server for **public** repositories too, rather than
falling back to the browser only on failure as ADR-0020 had it. Anonymous GitHub allows sixty requests
an hour per IP and the folder walk spends roughly one per file, so a shared office address exhausts it
in two or three imports; a connected writer's token has five thousand. A writer with no Connection
keeps the anonymous client-side path exactly as ADR-0010 describes it, which is what lets a Registry
with no GitHub Integration at all still import a public Skill.

Genericness stops at the credential. URL parsing and the public folder walk cover GitHub and GitLab
and are keyed on a provider string, so a third is a row and a URL pattern. The credentialed path is
GitHub only, and deliberately: a GitHub App has no GitLab equivalent, and pretending the credential
layer generalises would be the one abstraction here worth avoiding.
