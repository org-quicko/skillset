# 08 — Download a Skill

**What to build:** Anyone with access can download a Skill as a zip, to inspect it or install it by hand — and this is the route the CLI's install command will use.

**Blocked by:** 04 — Publish a Skill from the web interface.

**Status:** ready-for-agent

- [ ] The download route authorises the request first, then issues a short-lived presigned read location and redirects to it.
- [ ] The presigned location expires in about a minute, so a copied link is not a lasting way in.
- [ ] A reader can download; an unauthenticated request cannot.
- [ ] The downloaded file is named after the Skill.
- [ ] A Skill's page offers the download.
- [ ] A Skill whose Artifact was never uploaded fails with a comprehensible message rather than a broken or empty file.
