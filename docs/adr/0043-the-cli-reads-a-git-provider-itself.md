# 43. The CLI reads a Git Provider itself

## Status

Superseded by [ADR-0044](0044-install-from-a-repository-with-the-users-git-and-submit-for-approval.md):
the CLI now clones with the User's own git for both `install` and `publish`, and `--from` and
`--source` are gone. Kept for the reasoning. Originally: accepted. Extends [ADR-0010](0010-github-fetch-is-client-side-and-public-only.md)'s anonymous path
to a second caller. Does not reopen [ADR-0020](0020-private-repo-import-runs-server-side-as-the-caller.md)
or [ADR-0024](0024-import-is-a-github-app-and-login-stays-an-oauth-app.md), which stay the web's
path. Depends on [ADR-0041](0041-a-resource-records-where-it-came-from.md) for what gets recorded,
and through it [ADR-0042](0042-a-resource-is-identified-by-kind-namespace-and-name.md) for what
names the result.

## Context

Everything the web's Import is built from — an Integration, a Connection, a GitHub App, the
`/imports` routes — exists to compensate for one deficit: a browser cannot read a repository. The
CLI does not have that deficit. It runs on a developer's machine, with git on it and that
developer's own credentials already configured.

But `skillset publish` could read a disk and nothing else, so "this Skill lives on GitHub" had no
answer in the CLI. The workaround was to clone and publish the checkout, which worked and lost the
provenance: a publish that declares no Source reads as published-here (ADR-0041's fallback), so
Skills that plainly came from a repository recorded this Registry as their origin. The CLI was the
only publishing surface that could not tell the truth about where bytes came from.

Separately, `install` has to read a public repository folder too, for a reader pulling in an
outside Skill. So a folder walk has to exist in the CLI whichever way publishing goes.

## Decision

The CLI reads the provider's own API, anonymously, through the same `readSkillFolder` and
`discoverSkillFolders` the browser already uses (ADR-0010). **Public projects only.** No credential,
no git binary, and no request to the Registry in the middle.

`publish --from <url>` takes a repository URL, a tree at a ref, or a folder within one. A URL naming
one Skill folder publishes that Skill; a URL naming somewhere Skills live discovers each of them and
confirms the batch — the same two shapes, and the same confirmation, that pointing `publish` at a
path already has.

Each Skill records the **repository** it came from as its Source, without the ref or the folder
(ADR-0041), which is also what names it (ADR-0042).

**A private repository is reached by checking it out**, not by teaching the CLI a credential:
`skillset publish <path> --source <url>` publishes the working copy the developer's own git already
fetched and declares where it came from. That flag is the private-repo path, not a convenience, and
it closes the provenance gap above for every publish from a checkout — including ones that have
nothing to do with `--from`.

The provider `fetch` is injected like every other request in this CLI, rather than reaching for the
global.

## Considered Options

**Route through the Registry's `/imports` routes**, reusing what the web already has. Rejected, and
it is the option that looks like reuse. It needs a Connection, which is granted through a browser
OAuth flow the CLI has none of. The Integration's grant is per-repository and chosen by an
organisation owner (ADR-0024), so the Registry may well be unable to read a repository the CLI can
read directly. And it would have the API fetch a caller-supplied project on the CLI's behalf, which
is the request-forgery surface ADR-0020 went to some trouble to close, in service of reaching
something that was already within reach.

**`git clone --depth 1 --filter=blob:none --sparse`.** Genuinely attractive, and it was the first
answer here. It runs as the developer, so private repositories work for free, and it spends one
request where the walk spends many. Rejected because `install` needs the anonymous walk regardless —
a reader pulling an outside Skill has no checkout to publish from — so cloning would be a *second*
mechanism for the same job, and would add a git binary on `PATH` as a new requirement for a CLI that
has none. One resolver serving both commands is the simpler system. If the rate limit below ever
starts to bite, this is the option to move to, and only `bundlesFromUrl` changes.

**A token from the environment — `GITHUB_TOKEN`, or shelling out to `gh auth token`.** Rejected as
unnecessary today and as a new kind of secret in a CLI that deliberately holds one: its own Token,
which authenticates *to* a Registry rather than from it to somewhere else. `SkillFolderOptions.token`
is already the seam if this is ever wanted, so nothing here forecloses it.

## Consequences

**Anonymous means rate-limited.** GitHub allows sixty requests an hour per IP, shared by everyone
behind that address, and the walk spends one Contents API request per directory it visits plus one
download per file from the raw host. Discovering Skills across a large monorepo can exhaust that.
The walk already reports `rate_limited` distinctly from a refusal, so the message says to wait
rather than to re-authenticate, and the way through today is a checkout and `--source`.

**Public-only is stated, not detected.** A private repository answers an anonymous read with 404,
which is the same answer a typo gets. Nothing can tell them apart from outside, so the error names
both possibilities rather than guessing.

**The CLI now fetches a URL a User handed it.** The host is constrained to a Git Provider this
Registry knows before any request is made, and every request is built from that provider's pinned
API base rather than from the URL — the same shape ADR-0020 required of the server, for the same
reason.

**`--source` is load-bearing.** It is what makes public-only an acceptable limit rather than a hole,
so it is not a flag to drop later as redundant with `--from`.

**Nothing about the web's Import changes.** A writer with a Connection still reaches private
repositories through the server, still on their own grant. The two paths now differ in who fetches
and with what, and that difference is the point: the browser has no other option, and the CLI has a
better one.
