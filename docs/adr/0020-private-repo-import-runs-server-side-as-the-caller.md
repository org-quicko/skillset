# Private Repo Import Runs Server-Side, As The Caller

A writer can publish a Skill from a **private** GitHub repository they can already read. The
Registry fetches it server-side using that writer's own GitHub OAuth token, stored on their linked
account, and hands the files to the same publishing pipeline a dropped folder goes through.

This supersedes ADR-0010 on the point it named: private repositories are now reachable, and there
is a server-side fetch and a stored GitHub credential. Everything else in ADR-0010 stands, and the
anonymous client-side path it describes is still what serves **public** repositories — it needs no
credential, spends no server resource, and is the common case.

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
constraint. An authenticated request is 5,000 per hour per user, so the writer publishing several
GitHub-sourced Skills in a row stops being a problem — for private repositories. Public ones still
go anonymously from the browser and still have the old limit.

**Two paths now fetch from GitHub, and they are not merged.** The browser's anonymous path serves
public repositories; the server's authenticated path serves private ones. Keeping both means public
publishing still costs the Registry nothing and still works for a writer who has never signed in
with GitHub. The cost is that the walk logic exists twice, in `read-github-files.ts` and in
`GitHubImportService`, and a change to how a Skill folder is read has to be made in both.

**An import can reach a repository the Registry itself cannot see.** It runs as the writer, so what
it can read is exactly what they can read, and two writers importing the same URL may legitimately
get different answers. That is the intent, but it means a failed import is not evidence the
repository does not exist.
