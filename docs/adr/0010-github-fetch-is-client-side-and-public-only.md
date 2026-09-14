# GitHub Fetch Is Client-Side and Public-Only

> **Partly superseded by ADR-0020, then ADR-0024.** Private repositories are reachable now,
> through a server-side fetch using a credential the writer granted — so the two things this ADR
> rejected, a stored GitHub credential and a server-side fetch, both exist. ADR-0024 is the current
> account of what that credential is and how it is granted.
>
> The rest of this ADR stands, and is still the live path for **public** repositories imported by a
> writer with **no Connection**: anonymous, client-side, no credential, no server in the loop. A
> writer who *does* hold a Connection now takes the server-side path even for a public repository,
> because the anonymous budget is sixty requests an hour per IP and a folder walk spends one per
> file.

Publishing from a GitHub URL fetches the folder's files straight from the browser, anonymously,
through GitHub's own public REST API and `raw.githubusercontent.com`. The API never sees the URL
and never talks to GitHub; the fetched files are handed to the same `buildSkillBundle` pipeline a
dropped folder already goes through, and publishing proceeds exactly as it does today. Only public
repositories work, because there is no credential anywhere for GitHub to check.

## Considered Options

A server-side fetch — the API downloads the repository and re-serves it, or accepts the URL as
part of the publish request — was rejected. It would need a place to keep a GitHub credential in
order to also support private repositories, a decision this repo has deliberately avoided for
every other external system (there is no credential store today; Tokens in this Registry
authenticate *to* it, not *from* it to somewhere else). It would also mean the Registry's server
process fetching an arbitrary caller-supplied URL, which is a request-forgery surface with no
existing mitigation in this codebase. Anonymous, client-side, public-only sidesteps both: the
browser already trusts the sites it fetches from just as much as it trusts GitHub, and the
Registry's server is never in the loop at all.

Downloading the repository as a tarball (`codeload.github.com/.../tar.gz/...`) in one request,
rather than walking the Contents API directory by directory, was rejected: `codeload.github.com`
does not send CORS headers, so a browser `fetch` of it fails outright. The Contents API and
`raw.githubusercontent.com` both do.

## Consequences

Private repositories cannot be published from a URL. A writer with one downloads or clones it and
uses the existing drop zone instead — the two paths converge on the identical pipeline the moment
files exist, so this is not a missing capability, only a missing shortcut.

Anonymous GitHub API requests are rate-limited to 60 per hour per IP. A Skill folder with several
subdirectories spends one request per directory; a writer publishing many GitHub-sourced Skills in
a short window can be rate-limited. The failure message says so plainly rather than presenting a
generic error.

If a server-side path is ever added — to support private repositories, say — it needs its own
decision about where a GitHub credential lives and how a request-forgery surface is closed. Do not
casually add a `github_url` field to the publish API's request body without reopening that.
