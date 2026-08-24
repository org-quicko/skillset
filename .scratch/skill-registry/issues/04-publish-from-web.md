# 04 — Publish a Skill from the web interface

**What to build:** The demoable loop. A writer drops a Skill's folder onto the Registry or picks it from a dialog, learns about any problem before anything uploads, and then finds the Skill in the list and reads it.

**Blocked by:** 03 — Publish a Skill through the API.

**Status:** closed

- [x] A folder dropped onto the publish screen is read in full, including nested directories.
- [x] A folder can also be chosen from a file dialog, for when dragging is awkward.
      Fixed a bug where `handlePicked` read `event.target.files` after resetting
      `event.target.value`, so the live `FileList` could read back empty and the
      picker silently did nothing.
- [x] Validation runs before anything uploads, and a failure names the rule and the file that broke it.
- [x] Files that are not part of a Skill are excluded before the Artifact is built, so a stray version-control or dependency directory never fails a publish against a limit the writer did not know about.
- [x] A successful publish creates the row, uploads the Artifact directly to object storage, and refreshes the Skill list only once the upload has completed.
- [x] A failed upload is reported, and the message says that retrying the publish replaces rather than duplicates.
- [x] Publishing is not offered to readers.
- [x] The Skill list shows name, description, publisher, and published-at, most recent first, paginated, with the previous page staying visible while the next loads.
- [x] A Skill's page renders its `SKILL.md` as formatted text through an allowlist sanitiser, so markup inside a `SKILL.md` cannot execute against a reader's session.
- [x] Screens are assembled from shadcn/ui components and styled with Tailwind.
      "Publish a Skill" now opens as a modal dialog rather than swapping the list view.
