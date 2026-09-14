# Private Repo Import Runs Server-Side, As The Caller

> **Superseded in part by ADR-0024.** Everything below about running as the caller, closing the
> request-forgery surface, and encrypting the token at rest still governs. What no longer holds is
> the coupling — *"Connecting GitHub is signing in with GitHub"* — and the credential itself. The
> import credential is now a **GitHub App** granting `contents: read`, registered separately from
> the sign-in OAuth App and granted deliberately as a **Connection** in its own table. `repo` is
> not requested at login, the login token is not stored, and disabling the login does not withdraw
> import access. ADR-0023's intermediate design — one OAuth App authorized twice, an
> `import_enabled` flag, the grant on a `github-import` account row — was never built; do not
> follow it.
>
> One further reversal: a connected writer now takes the server-side path for **public**
> repositories too, rather than only on an anonymous failure. ADR-0024 explains why (rate limits).

A writer can publish a Skill from a **private** GitHub repository they can already read. The
Registry fetches it server-side using that writer's own GitHub OAuth token, stored on their linked
account, and hands the files to the same publishing pipeline a dropped folder goes through.

This supersedes ADR-0010 on the point it named: private repositories are now reachable, and there
is a server-side fetch and a stored GitHub credential.

It is also the path a **public** repository takes, for anyone signed in with GitHub. The token is
always sent, private repository or not. Sending it only when the anonymous fetch had already failed
was tried first and was worse on every axis that matters: it spent an anonymous request per import
against a 60-per-hour-per-IP budget shared by everyone behind the same address, it made a private
repository cost a round trip and a 404 before it could work at all, and it made the error a writer
saw depend on which of the two paths happened to fail — a repository the anonymous browser cannot
see and one the writer's own account cannot see are the same 404 from outside and want opposite
advice.

ADR-0010's anonymous client-side path survives for exactly one caller: a writer with no linked
GitHub account, who has no token to send. It reaches public repositories and nothing else.

ADR-0010 said what reopening it would require: *"it needs its own decision about where a GitHub
credential lives and how a request-forgery surface is closed."* Both are below.

## Considered Options

**A GitHub App with fine-grained permissions**, installed on chosen repositories by an org owner
and granting `contents: read` and nothing else. This is the better security posture and it is not
close: the grant is per-repository, auditable by the org, read-only, and independent of any one
person's account. It was rejected on cost — it is a second GitHub integration alongside the OAuth
App that already serves login (ADR-0018), with its own installation flow, its own token exchange,
and its own expiry handling, to reach a feature whose whole value is that it saves a `git clone`.
If the blast radius recorded below ever stops being acceptable, this is the option to move to, and
the import surface is deliberately shaped so that only the credential lookup changes.

**A personal access token pasted by each writer.** Rejected: it moves the same secret into the same
database with more human handling, expires on its own schedule, and makes every writer responsible
for scoping and rotating it by hand.

**Fetching client-side with the writer's token**, keeping ADR-0010's shape. Rejected: it means
handing a `repo`-scoped GitHub token to JavaScript, where any XSS in the Registry reaches every
private repository that writer can read. The server-side fetch keeps the token in one place that
the browser never sees.

**Asking for `repo` only at first import**, via incremental authorization. Rejected in favour of
requesting it at login, which is one flow and one consent rather than two — accepting that people
who never import still grant it.

## Where the credential lives

In `accounts.access_token`, on the row Better Auth already writes for a GitHub login. There is no
new credential store, no new table, and nothing for an operator to configure: connecting GitHub
*is* signing in with GitHub.

It is read fresh on every import rather than cached, so revoking the link or signing in again with
a new token takes effect immediately.

And it is only read at all while GitHub is an **enabled** Identity Provider. Connecting GitHub *is*
signing in with GitHub, so the reverse has to hold too: an operator who disables that login has
withdrawn the consent every stored token was collected under, and a Registry that kept spending
them would make the switch mean less than it says. Disabling the Provider therefore withdraws the
tokens as well as the button — the import refuses with `github_login_disabled` before the column is
so much as selected, whether or not the caller has a perfectly good token sitting in it. A Provider
that was never configured is treated identically; there is no delete route for one (ADR-0015), but
an instance restored from a backup can hold linked accounts without the Provider that made them.

The check reads the row per import, like the login's own `enabled` check (ADR-0019), so flipping
the switch takes effect on the next import rather than on the next restart. It is deliberately not
a matter of also deleting the tokens: disabling a Provider is reversible and routine, and a
re-enabled login should not force everyone to sign in again to get their access back.

## How the request-forgery surface is closed

The API never receives a URL. `POST /github/skill-files` takes `{ owner, repo, ref, path }` —
parts, already parsed and validated — and builds every outbound request itself as
`api.github.com/repos/{owner}/{repo}/...`. Owner, repo, and ref are constrained to
`[A-Za-z0-9._-]`, so none of them can carry a `/`, a `..`, or an `@` that would re-point the path;
`path` is rejected if any segment is `.` or `..`.

Two smaller holes are closed with it. Redirects are not followed (`redirect: "manual"`), because a
fixed host that follows a redirect is not a fixed host. And the one URL the service does not build
itself — the `download_url` GitHub returns per file — is checked to start with
`https://raw.githubusercontent.com/` before it is fetched.

The browser still parses the pasted URL, with the same `parseGitHubSkillUrl` it uses today. That is
not a security boundary and is not treated as one; the server re-validates every part it receives.

## Consequences

**The Registry now holds a credential that can write to every private repository each writer can
reach.** GitHub's OAuth `repo` scope is not divisible: it is read *and* write, across every private
repository, with no per-repository narrowing. Nothing in this feature writes anything — the import
is `GET`s — but the token is capable of it, and the database now holds one per GitHub-signed-in
User. A leaked backup was already an incident with Google or Microsoft (ADR-0015); it is now an
incident in every private repository those Users can touch — unless that backup is separated from
`BETTER_AUTH_SECRET`, which is what the encryption recorded below buys and the reason it is on. That
is the price of the option chosen, recorded plainly because it is the thing a future reader will
want to have been told.

**Everyone who signs in with GitHub grants it, whether or not they ever import.** The scope is
requested at login, so a reader who only browses Skills still hands over private-repo access. This
is the deliberate trade against a second consent screen at first import.

**Tokens are encrypted at rest.** Better Auth's `encryptOAuthTokens` defaults to off; it is turned
on here, so `accounts.access_token` holds AES-256-GCM ciphertext under `BETTER_AUTH_SECRET` rather
than a usable credential. This was first recorded as something to change later, on the grounds that
it changes how existing rows are read. It was done now instead, because the row it protects is the
one this ADR introduces: leaving the most dangerous column in the schema in plain text until a
follow-up is a worse trade than doing it while the column is new.

It does not strand what was already written. Better Auth checks whether a stored value even looks
encrypted and returns it untouched when it does not, so a plaintext row keeps working and is
re-encrypted the next time it is written.

The cost is that a decrypted read is now part of the import path rather than a plain column read,
and anything else that ever reaches for this column has to decrypt too — `GitHubImportService` does,
and it is the only such reader. A leaked backup is no longer a leaked credential, which is the
point; losing `BETTER_AUTH_SECRET` now costs every stored token as well as every session.

**Rate limits improve.** ADR-0010 recorded 60 anonymous requests per hour per IP as a real
constraint, and one shared by everybody behind that IP. An authenticated request is 5,000 per hour
per user, so the writer publishing several GitHub-sourced Skills in a row stops being a problem —
for public repositories as much as private ones, now that both send the token. The old limit is
reached only by a writer who has never signed in with GitHub.

**The Registry now pays for public imports it used to get for free.** Every GitHub-sourced publish
by a GitHub-signed-in writer is server-side traffic and server-side memory, where the anonymous path
cost the Registry nothing. That is the price of one predictable path, and it is bounded by the same
`ARTIFACT_MAX_ENTRIES` and `ARTIFACT_MAX_UNCOMPRESSED_BYTES` an upload is.

**Two paths still fetch from GitHub, and they are not merged.** The server's authenticated path is
now the ordinary one; the browser's anonymous path is the fallback for the cases where no token is
sent — an unlinked account, or a disabled GitHub Provider. Keeping it means publishing from a public
repository still works for someone who signed in with a password, and on an instance where GitHub
login was never turned on at all.

> **Amended.** This paragraph originally recorded a cost: *"the walk logic exists twice, in
> `read-github-files.ts` and in `GitHubImportService`, and a change to how a Skill folder is read has
> to be made in both."* That is no longer true, and it had already gone wrong — the two copies had
> drifted, with the entry and byte ceilings, the `download_url` host check, and `redirect: "manual"`
> present on the server side only.
>
> The walk now lives once, in `readGitHubFolder` (`packages/shared/src/github-folder.ts`). The two
> paths are still two paths and this ADR's decision is unchanged: the server sends the caller's
> token, the browser sends nothing, and which one runs is still chosen by the fallback rule below.
> The token is simply an optional parameter rather than a second implementation — it was the only
> thing that ever differed.
>
> Two consequences worth naming. The anonymous path now enforces the same ceilings and the same host
> check as the server, so a public import is bounded where it previously was not. And a rate-limited
> 403 is now told apart from a refusal on *both* paths; the server used to answer every 403 with
> "sign in with GitHub again", which is advice that fixes nothing when the real problem is 5,000
> requests an hour.

The fallback is chosen on `github_not_connected` and `github_login_disabled`, and on nothing else —
every other refusal is one the writer's own access produced, and re-asking anonymously would only
replace a reason they can act on with one they cannot. Those two are told apart rather than merged
into one "no token" code because their remedies belong to different people: one is *sign in with
GitHub*, the other is *ask an Admin to turn it back on*, and on an instance with that login off the
first is advice nobody can take. When the anonymous retry then reports the repository is not public
— all a credential-less browser can ever learn — it is the original reason that surfaces, not the
404.

**An import can reach a repository the Registry itself cannot see.** It runs as the writer, so what
it can read is exactly what they can read, and two writers importing the same URL may legitimately
get different answers. That is the intent, but it means a failed import is not evidence the
repository does not exist.
