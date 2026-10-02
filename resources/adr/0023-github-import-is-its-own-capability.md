# Importing From GitHub Is Its Own Capability, Not A Side Effect Of Sign-In

> **Superseded by ADR-0024, and never implemented.** The separation this ADR argued for is
> correct and survives: signing in and granting repository access are two acts, two consents, and
> two revocations. The mechanism does not. There is no `import_enabled` flag, no second
> authorization of the sign-in OAuth App, and no `github-import` row in `accounts`. Import uses a
> **GitHub App** registered separately, with the grant in its own `connections` table.
>
> The one thing to read here rather than in ADR-0024 is the argument about `GET /user/orgs`
> returning an empty list for a fine-grained token. That finding still stands and is exactly why
> one GitHub App cannot serve both purposes — ADR-0024 reaches the opposite conclusion from the
> same fact only because it stopped trying to make one app do both.

One GitHub OAuth application still serves this Registry, but it now serves **two capabilities that
are switched on independently**: *Sign-in*, which makes GitHub an Identity Provider, and *Import*,
which lets a writer read a Skill folder out of a repository. Each has its own flag, its own consent,
and its own revocation.

This supersedes ADR-0020 on its central claim. That ADR said, in as many words, *"Connecting GitHub
**is** signing in with GitHub"*, and built two things on it: the `repo` scope was requested at login
so everyone who signed in granted it, and disabling the login withdrew every stored token along with
the button. Both are reversed here. What ADR-0020 decided about request forgery, about running as
the caller, and about encrypting the token at rest is untouched and still governs.

The coupling was defensible while linking and logging in were the same act. It stopped being
defensible the moment either half was wanted without the other, and both were: a Registry whose
people sign in with Google but whose writers still keep Skills in private GitHub repositories, and a
Registry that wants the login convenience without holding a `repo`-scoped token for every User in
its database.

## Considered Options

**One GitHub App instead of the OAuth App.** This is the better credential and it is not close:
`contents: read` rather than `repo`, chosen per repository by an organisation owner, and revocable
by uninstalling rather than by the Registry promising not to look. It is rejected because a GitHub
App cannot run this Registry's login gate. GitHub App user access tokens are fine-grained, and
GitHub's own documentation says of `GET /user/orgs`: *"Requests using a fine-grained access token
will receive a 200 Success response with an empty list."* That is the exact call
`fetchGitHubIdentity` makes and the exact condition that raises `oauth_app_not_approved` — so every
single login would be refused with a message about an unapproved app.

The gate could be rebuilt on `GET /user/installations`, and that was weighed. It fails on what it
does to the gate's meaning: "a member of a permitted organisation" would become "a member of a
permitted organisation *that has installed this app*", so an Admin could not permit an organisation
that had not installed it, and nobody could sign in with GitHub until an owner did. That trades the
coupling this ADR removes for a worse one — sign-in availability made dependent on an installation —
and rewrites ADR-0018, the subtlest code in the auth path, to get it.

**Two applications: the OAuth App for sign-in, a GitHub App for import.** Strictly the best outcome
on security, and it needs no change to the login gate at all, because the gate keeps its OAuth App.
Rejected on setup burden: a self-hosted operator would register two applications with GitHub and
configure two credential pairs to stand up one Registry. This remains the option to move to if the
blast radius recorded below stops being acceptable, and it is cheap to reach — nothing in the login
path would change.

**A second OAuth App for import.** Rejected: it costs the same second registration as the GitHub App
and buys a `repo` token instead of a `contents: read` one. If a second application is ever worth
registering, it should be the good one.

**Keeping the single flag and living with the coupling.** Rejected — it is the thing being fixed.

## The two capabilities

`identity_providers.enabled` keeps its meaning exactly: whether this Provider is offered on the
login page and whether Better Auth will complete a sign-in through it. `/auth/providers` and
`socialProvidersFor` are unchanged.

`identity_providers.import_enabled` is new and governs Import alone. It is meaningful only on the
`github` row; the column exists on all three because the credential pair does, and one row per
application is worth more than a second table and a join to keep two `google` and `microsoft`
booleans from being dead.

The four states are all reachable and all mean something. Both on is the ordinary deployment. Import
on with Sign-in off is a Registry whose people arrive through Google. Sign-in on with Import off is
an operator who wants the login and refuses to hold private-repository credentials. Both off leaves
GitHub inert, and publishing from a public repository still works through the browser's anonymous
fetch (ADR-0010), which survives for exactly that reason.

## Where the consent lives

Not on the login. Login asks for `read:user`, `user:email`, and `read:org` — what the gate needs and
nothing more. `repo` is gone from it.

A writer grants repository access separately, through a second authorization recorded under
`provider_id: "github-import"` via Better Auth's `genericOAuth` plugin, against the same
application. That row **is** the consent: it exists only because someone completed the connect flow,
so there is no consent column to keep in sync with it and no state that can disagree with the
credential it sits beside. A User therefore has up to two `accounts` rows for GitHub — the sign-in
and the Connection — which the existing unique index on `(provider_id, account_id)` already
allows.

Only a `writer` may create one. A reader cannot import, so a reader handing over a `repo` token
would be handing over a credential with no reachable use.

## What the login token is not

Better Auth writes an access token for a GitHub sign-in. After this decision nothing reads it, so it
is not stored.

That is not tidiness. GitHub OAuth applications hold one authorization per user and scopes only ever
accumulate: once someone has granted `repo`, *"the user won't be shown the OAuth authorization page
with the list of scopes. Instead, this step of the flow will automatically complete with the set of
scopes the user has authorized for the application."* So for everyone who signed in before this
change, the login flow will keep returning a `repo`-capable token no matter what this Registry asks
for. Not storing it is what stops the database from holding an encrypted copy of a credential
nobody can use and nobody re-consented to.

It is also why the Connection is identified by its own row rather than by inspecting
`accounts.scope`. That column records what GitHub *granted*, which for an existing User says `repo`
whether or not they have ever consented to an import. Sniffing it would have silently connected
every pre-existing GitHub user to a capability they were never asked about.

## What is deliberately not gated

**The organisation gate does not run on a Connection.** `CONTEXT.md` defines Permitted Organisation
as the control on *who gets an account*, and a Connection creates no account — the User was admitted
already, through this Provider or another one. Running it here would overload that term with a
second meaning, which is the mistake this whole ADR exists to undo, and it would refuse the ordinary
case of a personal login beside a work GitHub.

**A Connection need not be the same GitHub account the User signs in with.** It follows from the
above: if the connecting account is not being judged as an identity, there is no reason it must be
the identity.

**There is no allowlist of importable owners.** A writer can import from any repository their
connected GitHub can read. Publishing already requires a role an Admin granted deliberately, and the
same writer can upload the same folder from their laptop after cloning it — an allowlist would close
the convenient path and leave the manual one open, which is theatre.

## Lifecycle

Turning **Import** off refuses to spend tokens and leaves the rows, so it is reversible and does not
force everyone to reconnect. Turning **Sign-in** off does nothing to Connections at all — after this
ADR they were not collected under the login's consent, so there is nothing for the login's switch to
withdraw. Disconnecting import deletes the Connection and leaves the sign-in account row untouched,
so a User whose only credential is GitHub cannot lock themselves out by revoking repository access.
A demotion below `writer` clears the Connection, because a credential its holder can no longer use
should not outlive the role that justified it.

Users linked before this change have no `github-import` row and so are simply not connected. They
connect once, and that click is the first time anyone has actually been asked.

## Consequences

**Revocation is Registry-local, and the interface must not pretend otherwise.** Disconnecting clears
what the Registry holds; it does not withdraw the grant at GitHub, which only the User can do from
their own applications page. With one OAuth application there is no way to make it mean more than
that — the alternative that would have, a separate application, was rejected above on setup cost.
"Revoked" here means *the Registry will not use it*, and the copy has to say so.

**Everyone who signed in before this change keeps a `repo` grant at GitHub.** It was deliberately
not revoked: `DELETE /applications/{client_id}/grant` withdraws the entire authorization, so every
one of them would face a consent screen at their next sign-in to clean up a grant the Registry no
longer holds a token for. The grant lingers until each person clears it themselves. Not storing the
login token is the mitigation, and it is a partial one.

**ADR-0020's blast radius is reduced but not removed.** A Connection still carries `repo`, which
GitHub does not divide: read *and* write across every private repository that writer can reach. What
changes is who holds one. It is no longer everybody who ever signed in — it is the writers who
deliberately connected, and it is visible, because the Admin's Users card now shows who has a
Connection. That question was previously answerable only in `psql`.

**`GitHubImportService` stops reading `identity_providers` for the login flag** and reads
`import_enabled` instead, still per import (ADR-0019), so the switch takes effect immediately. Its
`unauthorized` message changes with it: *"Sign in with GitHub again to refresh the Registry's
access"* became wrong the moment the import token stopped coming from the login, and now says to
reconnect.

**A third refusal code, and the fallback rule is unchanged in shape.** `github_login_disabled`
becomes `github_import_disabled`; `github_not_connected` now covers both an unconnected User and a
pre-change link, because their remedy is the same click. Both still trigger the browser's anonymous
public-repository fallback, and every other refusal still does not — a reason the writer can act on
must not be replaced by a 404 they cannot.
