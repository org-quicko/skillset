# An Artifact Is Stored as Its Files, and the Zip Is Assembled on Demand

An Artifact is stored as **one object per file**, under `resources/<id>/` — the Skill's own layout,
preserved. Publishing sends the Artifact's *manifest* (each file's path and size) as part of the
metadata claim and gets back one presigned `PUT` per file; a republish deletes the files the new
manifest no longer names before issuing those URLs. The zip nobody stores any more is assembled
per request by `GET /resources/{id}/artifact`, which is also the only read that records an
Install. Two new reads serve the files themselves: `GET /resources/{id}/files` lists what storage
holds, and `GET /resources/{id}/files/{path}` returns one file's bytes with a `content-type`
derived from its path.

> **Amends ADR-0001.** Uploading still bypasses the API entirely, which is the half of that
> decision it was actually about — and the API still never reads an uploaded Artifact to check it.
> What changes is the *read* path: Artifact bytes now pass through the application process, to be
> zipped or previewed. ADR-0001's "keeps bundle bytes out of the application process entirely" no
> longer holds on the way out.
>
> **Amends ADR-0026.** The storage key is still derived from the Resource's `id` and never from its
> `name`, for exactly the reason ADR-0026 gives. It is now a prefix rather than a single key.

## Why

The Registry could not show anyone what was inside a Skill. A zip is opaque to a browser: the
interface could offer the bytes and render the `body` column, and that was the whole of it — a
reader could not see that a Skill ships four reference documents and three scripts, let alone read
one, without downloading and unpacking it first. Every Skill in the catalog was, in effect,
described by its own summary.

Storing the files is what makes them addressable. Once each file is an object, the interface can
list them and read one, and there is no unpacking step in between.

## Considered Options

**Storing the zip and the files both.** The smallest change: keep every existing path working and
add the files beside them. Rejected because it makes two representations of the same bytes, with
nothing keeping them in step — a republish that wrote one and failed on the other leaves a
Registry serving a zip that disagrees with the file listing, and nothing detects it. ADR-0001
already accepts drift between the metadata claim and the Artifact; this would have added a second
kind, between two things the Registry itself writes.

**Dropping the zip entirely.** Also coherent, and briefly the plan: `skillset install` would fetch the
manifest and one presigned `GET` per file, writing them straight to disk, and most of `extract.ts`
would go away with the archive it parses. Rejected on the browser: the web Download control would
have to fetch each file and zip them client-side, and fetching a presigned URL from a page needs
bucket CORS — which this codebase deliberately does not depend on (`use-skills.ts` navigates to a
download rather than fetching it, precisely so "the actual transfer is never subject to storage's
CORS policy"). It would also foreclose ADR-0030's marketplace, whose `archive` source needs an
archive.

Worth keeping in view: if the interface's own reads ever move to presigned URLs — which needs
that CORS decision reopened — this option becomes available again, and the API stops touching
Artifact bytes at all.

**Caching the assembled zip back to storage.** Rejected as the first option in different clothes.
It is the same two representations, with the added job of invalidating one on every republish.
Revisit only if the rebuild cost shows up in practice.

**Unzipping server-side at publish time.** Would have kept the client's upload as one request. But
it means the API reads the Artifact, which is the decision ADR-0001 exists to avoid, and it moves
a zip parser — the security-sensitive one in `extract.ts` — into the request path. Declaring the
manifest costs the client nothing it does not already know.

## Consequences

**The API now validates Artifact paths, which it previously could not.** It is told each path
before it signs an upload for it, so `validateArtifactManifest` refuses traversal, absolute paths,
backslashes, null bytes, duplicates, a missing root `SKILL.md`, and the count and size limits —
server-side, on every publish, from any client. Under ADR-0001 none of that was checkable: the
paths lived inside bytes the API never opened, and `skillset install` was the only thing that ever
saw them. This is a strict gain, and it is worth being clear that it is a gain in *shape* and not
in *content*: the sizes are the publisher's own claims, and nothing still checks that the bytes
which arrive match them.

**A partial upload is now a reachable state.** One presigned `PUT` either happened or did not; N
of them can half-happen, leaving a row published and an Artifact missing files. `GET /files` is
therefore defined to report what storage holds rather than what the manifest declared, so the
interface shows the honest state, and the zip endpoint refuses rather than serving an archive
short a file the caller was told to expect. The fix is the same as it always was for a failed
upload: publish again (ADR-0002). There is no partial-upload cleanup, and a Registry that wants
one wants a finalize call — the round-trip ADR-0001 rejected.

**A republish deletes before it uploads.** The alternative — upload, then prune — would keep the
old Artifact whole for longer, but it also means a file the publisher dropped stays servable
during the window, which is worse than a briefly incomplete Artifact. So the window is incomplete
rather than stale, deliberately.

**The zip is rebuilt on every download, and is not free.** Every file is read from storage and
compressed per request, bounded by the 25 MiB of files a publish may declare. That is the price of
one stored representation, and it is paid on a path — a human clicking Download, or `skillset install`
— where it is unlikely to be the slow part. It does mean a download is no longer a redirect the
API is uninvolved in: it now occupies the application process for the length of the transfer.

**Publishing is N+1 requests instead of two.** The CLI and the web interface both fan the uploads
out concurrently, but a Skill with 200 files makes 200 presigned URLs and 200 `PUT`s. The entry
limit (1000) bounds it.

**Serving a publisher's files from this origin is an XSS surface, and HTML and SVG are the two
types that make it one.** Both are served under a `Content-Security-Policy` that forbids scripts,
plugins, and every external fetch, and sandboxes the result. The policy is applied *by type*
rather than blanketly, because `default-src 'none'; sandbox` also stops a browser's own PDF viewer
from loading — a blanket policy would have traded a working preview for a defence against
markdown. Every response carries `X-Content-Type-Options: nosniff`, since the `content-type` is
guessed from the path and a browser must not be allowed to guess differently.

**`GET /resources/{id}/artifact` no longer has a JSON representation.** It used to return the
Skill alongside a presigned `url`, so the web's Download control could confirm the request
succeeded before navigating. With no presigned URL left to hand back, the control navigates
straight at the endpoint and invalidates the Skill query afterwards. Nothing is lost that was
real: `installs` carried `refreshInstallCounts` lag either way (ADR-0012), so that representation
never guaranteed a fresh count.

**Nothing was migrated.** Objects at `resources/<id>.zip` are orphaned, not read and not deleted;
the Skills that had them were re-published. A deployment with data it cares about needs a script
that lists those keys, unzips each, and writes the files under the new prefix — and should write
it before deploying this, not after.
