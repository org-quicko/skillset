# The Registry Does Not Inspect Artifacts

Clients upload a Skill's zip straight to object storage with a presigned `PUT`, and post
`name`, `description`, and the `SKILL.md` body as a separate JSON claim. The server
validates that claim against the shared schema, but it never reads the zip — so it cannot
confirm the Artifact is a zip at all, let alone that its frontmatter matches the row.
We chose this for a simpler upload path that keeps bundle bytes out of the application
process entirely.

## Considered Options

Routing uploads through the API so the server could validate authoritatively, and a
`finalize` call that fetches and validates the object after upload, were both considered
and rejected as unnecessary round-trips.

## Consequences

Validation lives at the two edges and never in the middle. The authoring client checks
bundles before upload, which catches honest mistakes; `skillreg add` performs full
path-safety and size/entry-cap validation at **extraction** time, which is what actually
protects a developer's filesystem from a hostile bundle — a registry-side check could not,
since the bytes are already on the machine by then.

Anything a browser can post, `curl` can post too. The database's `name`, `description`,
and `body` may disagree with what is inside the Artifact, and nothing detects the drift.

Do not "fix" this by moving validation server-side without also reconsidering the upload
path — the two are the same decision.
