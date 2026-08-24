# 08 — Download a Skill

**What to build:** Anyone with access can download a Skill as a zip, to inspect it or install it by hand — and this is the route the CLI's install command will use.

**Blocked by:** 04 — Publish a Skill from the web interface.

**Status:** closed

- [x] The download route authorises the request first, then issues a short-lived presigned read location and redirects to it.
- [x] The presigned location expires in about a minute, so a copied link is not a lasting way in.
- [x] A reader can download; an unauthenticated request cannot.
- [x] The downloaded file is named after the Skill.
- [x] A Skill's page offers the download.
- [x] A Skill whose Artifact was never uploaded fails with a comprehensible message rather than a broken or empty file.

Fixed a 500: the API's storage client used `STORAGE_ENDPOINT=http://localhost:9000`,
which the download route's `.exists()` check calls from inside the `app` container,
where `localhost` doesn't reach the `minio` container. Split the setting into an
internal endpoint (used for real calls) and `STORAGE_PUBLIC_ENDPOINT` (used only
when signing URLs the browser follows).
