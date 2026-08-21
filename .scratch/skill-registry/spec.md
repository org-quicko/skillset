# Skill Registry

Status: ready-for-agent

## Problem Statement

A team writing Agent Skills has nowhere shared to put them. Each Skill is a directory with a `SKILL.md` at its root, and today it lives in whichever repository or laptop it was written on. Improving someone else's Skill means asking them for it. Using one means finding it, copying it, and hoping it is the current version. Discovering that a Skill exists at all depends on somebody remembering to mention it.

The public alternatives do not fit. They index public GitHub repositories, so putting an internal Skill in one means publishing it. A team wants the same convenience — search, browse, one command to install — over Skills that stay private.

## Solution

A self-hosted Registry the team runs itself. Writers publish a Skill from the CLI or by dropping its folder into the web interface. Anyone on the team can browse, search full text, read a Skill's `SKILL.md` rendered in the browser, and download it. `skillreg add` installs a Skill straight into the directory a coding Agent reads from, asking which Agent and which Scope.

Access is closed by default. The first person to sign up becomes an Admin; after that, the public signup route stops existing and Admins create Users directly. Users are readers, writers, or Admins. The CLI authenticates with a Token the User mints for themselves.

## User Stories

### Discovering and reading Skills

1. As a reader, I want to see every Skill in the Registry on one page, so that I can find out what my team has already written instead of duplicating it.
2. As a reader, I want the Skill list ordered by most recently published, so that the list doubles as a record of what changed lately.
3. As a reader, I want the list paginated, so that it stays fast and scannable as the Registry grows.
4. As a reader, I want to search Skills by full text across name and description, so that I can find a Skill by the problem it solves rather than by the name somebody else chose for it.
5. As a reader, I want to open a Skill and read its `SKILL.md` rendered as formatted text, so that I can judge whether it does what I need without downloading anything.
6. As a reader, I want to see who published a Skill and when, so that I know who to ask about it.
7. As a reader, I want to download a Skill as a zip, so that I can inspect or install it by hand.
8. As a reader, I want to be refused permission to publish, so that I cannot accidentally overwrite the team's work.

### Publishing from the web interface

9. As a writer, I want to drag a Skill's folder onto the web interface, so that I can publish without archiving it first.
10. As a writer, I want to pick a folder from a file dialog instead of dragging, so that publishing works when drag-and-drop is awkward.
11. As a writer, I want the web interface to validate my Skill before it uploads anything, so that I learn about a bad `SKILL.md` immediately rather than after waiting on a transfer.
12. As a writer, I want a specific reason when validation fails — which rule, which file — so that I can fix it without guessing.
13. As a writer, I want files that are obviously not part of my Skill excluded automatically, so that a stray version-control or dependency directory does not fail my publish against a limit I did not know about.
14. As a writer, I want publishing an existing Skill to replace it, so that improving a shared Skill does not require asking its original author.

### Publishing from the CLI

15. As a writer, I want to publish a Skill from the directory I am working in, so that publishing is part of my normal editing loop.
16. As a writer, I want to point the CLI at a path containing several Skills and publish them all, so that I can maintain a collection of Skills in one repository.
17. As a writer, I want every discovered Skill validated before any of them is published, so that a typo in the last one does not leave the first four already overwritten.
18. As a writer, I want to see the list of Skills that are about to be replaced and confirm before it happens, so that running the command one directory too high cannot silently rewrite half the Registry.
19. As a writer running in CI, I want to skip that confirmation with a flag, so that automation is not blocked on a prompt.
20. As a writer, I want a per-Skill result after a batch publish, so that I know exactly what landed.
21. As a writer, I want the CLI to ignore version-control and dependency directories when walking for Skills, so that it finds my Skills and not their contents.
22. As a writer, I want the CLI to stop descending once it finds a `SKILL.md`, so that a Skill's own supporting directories are never mistaken for Skills of their own.

### Installing Skills

23. As a reader, I want to install a Skill by name from the CLI, so that I do not have to download and unpack an Artifact by hand.
24. As a reader, I want to be asked which Agent I am installing for, so that the Skill lands where that Agent actually reads from.
25. As a reader, I want to be asked whether to install for this project or for my user account, so that I can choose between sharing it with the repository and having it everywhere.
26. As a reader, I want to see the resolved directory before or as it is written, so that I can tell where the Skill went.
27. As a reader, I want to be told when the directory I am installing into serves several Agents at once, so that I do not run the command again believing I have more to do.
28. As a reader, I want to pass the Agent and Scope as flags, so that installing works in a script with no prompts.
29. As a reader running with no terminal attached and no flags, I want a clear error rather than a guessed default, so that automation never silently installs to the wrong place.
30. As a reader, I want only Agents whose directories have been verified to be offered, so that I am never sent to a plausible-looking directory that nothing reads.
31. As a reader, I want my Agent's own environment overrides respected, so that a non-default configuration directory still works.
32. As a reader, I want a hostile Artifact to be rejected while it is being extracted, so that installing a Skill cannot write outside the directory I chose.

### Authentication and Tokens

33. As the first person to reach a fresh Registry, I want to sign up and become an Admin, so that the Registry can be set up without a manual database step.
34. As an Admin, I want the public signup route to stop working once I exist, so that nobody who can reach the Registry can give themselves an account.
35. As a User, I want to log in with my email and password, so that I can use the web interface.
36. As a User, I want to be made to change my password the first time I log in, so that the credentials my Admin generated stop being valid immediately.
37. As a User, I want to change my password whenever I like, so that I am not dependent on an Admin to rotate it.
38. As a User, I want to correct my own first and last name, so that my name appears correctly against the Skills I publish.
39. As a User, I want to mint a Token for the CLI, so that I can publish without typing my password into a terminal.
40. As a User, I want my Token shown exactly once, so that it is not sitting in a page I might leave open.
41. As a User, I want to see when each of my Tokens was last used, so that I can tell which ones are dead.
42. As a User, I want to revoke a Token, so that a leaked one stops working immediately.
43. As a User, I want a Token to carry only my own role, so that lending it out cannot grant more than I have.
44. As a User, I want to check which Registry I am authenticated against and as whom, so that I can tell a wrong URL from a revoked Token.
45. As a User, I want the CLI to remember my Registry and Token, so that I log in once per machine.
46. As a User in CI, I want environment variables to override that stored configuration, so that the same command works without a login step.

### Administration

47. As an Admin, I want to create a User with a first name, last name, email, and role, so that someone can start using the Registry.
48. As an Admin, I want to generate that User's initial password, so that onboarding does not depend on email delivery.
49. As an Admin, I want to change a User's role, so that access can follow what someone actually does.
50. As an Admin, I want to remove a User, so that access ends when someone leaves.
51. As an Admin, I want to be prevented from removing or demoting the last Admin, so that the Registry cannot be locked out of its own administration.
52. As an Admin, I want to delete a Skill, so that a mistake or an obsolete Skill can be cleared out.
53. As an Admin, I want to confirm a deletion by typing the Skill's name, so that an irreversible action cannot happen on a stray click.
54. As a writer, I want deletion withheld from me, so that a fumbled name is a cleanup request rather than lost work.

### Operating the Registry

55. As an operator, I want to bring the Registry up with a single compose command, so that evaluating it does not start with provisioning a database.
56. As an operator, I want database migrations to run when the Registry starts, so that upgrading is just a new image.
57. As an operator, I want the Registry to refuse to start without its signing secret, so that a missing secret is a loud failure rather than every session silently breaking on restart.
58. As an operator, I want to point the Registry at my own object storage and database, so that production does not have to look like the default.

## Implementation Decisions

### Shape

- One workspace, four parts: the API, the web interface, the CLI, and a shared module. The API serves the built web interface as static assets from the same origin, so production is a single container next to Postgres 18.
- The web interface is a React single-page application styled with Tailwind CSS and assembled from shadcn/ui components. It reads and writes exclusively through the API — the same contract the CLI uses — so there is one data path rather than a separate server-rendered one, and the API's own tests cover the reads that users actually hit.
- Server state in the web interface is held by TanStack Query: reads are queries keyed by the API contract, writes are mutations that invalidate the keys they affect. Four consequences to get right. A publish invalidates the Skill list only once the Artifact upload has completed, so the interface never presents a Skill as finished while its upload is still in flight. A failed upload is recovered by retrying the publish, which replaces rather than duplicates — this is the writer's only recourse, because writers cannot delete. A minted Token is a mutation result and is never cached, since it is shown exactly once. And a single shared handler treats an unauthenticated response as an expired session, discards cached state, and returns the User to login — which is how the session-expiry gap accepted in ADR-0005 surfaces to a User.
- The shared module (`packages/shared`, `@skill-registry/shared`) owns everything the CLI and the web interface must agree on with the API: the `SKILL.md` frontmatter parser, the validation schema and its limits, the Agent table, and the request and response shapes — defined as Zod schemas, with `z.infer` giving every consumer its TypeScript type from the same definition rather than a hand-written one. This is what makes local pre-flight checks, the API's own request validation, and response shaping the same rule rather than two or three drifting copies — a route shapes its response with `schema.parse(row)`, not a hand-written mapping function.
- The CLI is published to npm as a scoped package with the binary name `skillreg`, built from this workspace against the shared module.
- One naming convention, not two. Every JSON key on the wire is snake_case, which lines wire keys up with Postgres column names — and TypeScript uses the same snake_case keys throughout, including Drizzle's column definitions and every domain type, because they are `z.infer`red from the same shared schema the wire uses. There is no camelCase domain shape and no conversion boundary to keep in sync; a Drizzle row already matches the wire shape it will become.
- The API follows REST conventions: resources rather than actions. Initialising the Registry and reading whether it has been initialised are two methods on the Registry itself; a Token is nested under the User who owns it, because a User may only ever manage their own; an Artifact is a sub-resource of its Skill rather than a download verb; and publishing is an idempotent replace of a Skill addressed by name, which is exactly the semantics ADR-0002 chose. Logging in and out are the deliberate exception, kept as named routes under authentication — there is no session resource to create or delete, because the session is a signed token and nothing is stored (ADR-0005).

### Domain model and schema

- A Skill is identified by the `name` in its `SKILL.md` frontmatter. Flat, no namespacing, no version history. Publishing replaces what is there. See ADR-0002.
- Users table: email as the identifier and unique key, first name, last name, password hash, role (`reader` / `writer` / `admin`), a flag forcing a password change, timestamps.
- Tokens table: owner, display name, hash of the secret, created-at, last-used-at. The secret itself is never stored.
- Skills table: `name` as primary key, description, the `SKILL.md` body, publisher, published-at, and a generated `tsvector` column over name and description with a GIN index over it.
- Passwords and Tokens are hashed with the runtime's built-in argon2id; there is no separate hashing dependency and no salt-rounds setting to tune.
- `tsvector` has no native representation in the ORM, so it needs a custom column type, and the generated column is declared in a hand-written migration.

### Publishing

- Both the CLI and the web interface perform the same three steps: parse and validate the Skill, create or replace its row, then upload the Artifact.
- Creating the row comes first and returns a presigned upload URL. The Artifact is then uploaded directly to object storage. Artifact bytes never pass through the API. See ADR-0001.
- The API validates the posted metadata — name, description, body — against the shared schema. It does not read the Artifact and therefore cannot verify that the metadata matches it. This is a recorded trade-off, not an oversight; see ADR-0001 before changing it.
- Validation rules, shared by every surface: `name` present, 1–64 characters, lowercase alphanumerics and hyphens only, no leading, trailing, or doubled hyphen; `description` present and at most 1024 characters; a `SKILL.md` at the root of the Skill. Structural limits on the Artifact: at most 10 MiB transferred, 25 MiB uncompressed, 1000 entries. Entries with `..` segments, absolute paths, drive letters, null bytes, or symlinks are rejected. These match the corresponding rules in `vercel-labs/skills`, so a Skill published here stays portable.
- An Artifact archives the Skill's *contents* at its root, not a wrapping directory. A single wrapping directory is tolerated and stripped on extraction; genuinely ambiguous layouts are rejected rather than guessed at.
- Files that are not part of a Skill — version-control metadata, dependency directories, dotfile directories, editor artifacts — are excluded before archiving, because they would otherwise breach the entry limit and produce an error about files the writer did not know they were sending.
- The CLI's walk treats any directory containing a `SKILL.md` as a Skill and does not descend into it. Depth is capped at three levels. If the given path itself contains a `SKILL.md`, that is the single Skill to publish.
- A batch validates every discovered Skill before publishing any of them, and aborts the whole batch on any failure. When more than one Skill is discovered, the CLI lists what will be replaced and requires confirmation, skippable with a flag for non-interactive use.

### Reading

- Listing is paginated at 50 per page via a page parameter, ordered by most recent publication. The page and the search term are part of the query key, and the previous page stays visible while the next one loads rather than the list emptying between pages.
- Search uses the generated `tsvector` with a web-search-style query parser. Exact-name lookup does not go through search; it hits the primary key.
- A Skill's page is a single query — the stored body is rendered as markdown. The markdown is authored by writers and rendered same-origin to Admin browsers, so it is sanitised with an allowlist and raw markup is not passed through.
- Download authorises the request, then issues a short-lived presigned read URL (about 60 seconds) and redirects to it.

### Storage

- Object storage sits behind an adapter so that a second implementation is possible later. Only S3 is implemented.
- The adapter implements the full standard object-storage contract rather than only the operations the current flows need: put, get, exists, delete, list by prefix, presign for upload, and presign for download. Note that there are two presigners in opposite directions — publishing needs a presigned upload and downloading needs a presigned read.
- Because publishing uploads directly and downloading redirects, today's flows only reach for the two presigners and delete. The remaining operations exist so that the contract is complete and a second implementation has an unambiguous target.
- Postgres remains the index. The listing operation exists as part of the contract and must not be used to enumerate Skills — reading the bucket instead of the database is how the two get to disagree.
- One object per Skill. Deleting a Skill deletes its row and its object.
- Bucket versioning must be enabled: it is the only recovery path from a replaced or deleted Artifact. See ADR-0002.
- The bucket needs a cross-origin policy permitting uploads from the Registry origin, including the content-type header. Without it the browser upload fails with an opaque error.

### Access control

- Reader: browse, search, view, download. Writer: additionally publish, including replacing any existing Skill. Admin: additionally delete Skills and manage Users.
- Ownership of a Skill is deliberately not modelled — any writer may replace any Skill. Publisher and published-at exist so that change is attributable. See ADR-0002.
- The last Admin cannot be demoted or removed.
- Web sessions are a signed token in a strictly same-site, http-only, secure cookie, carrying only the User id. The role is resolved from the database on every request, so a demotion takes effect immediately. See ADR-0005.
- Token authentication looks up the presented secret by hash on every request and resolves the owner's current role the same way.
- The initialisation route is available only while no Users exist, and the User it creates is an Admin.
- The auth layer is shaped so that OIDC — Google Workspace first — is additive rather than a rewrite (ADR-0007). Authentication resolves a request to a User; issuing a session takes that resolved User rather than a set of credentials, so a second way to log in is a new route and nothing more. A password is optional on a User, and `must_change_password` is meaningful only where one exists. Tokens are untouched, which is why they were chosen over password-based CLI login in the first place. Deliberately not built: an identity table, a provider abstraction with no providers, and any domain allowlist.

### Installing

- The Agent-to-directory table is our own data, derived from `vercel-labs/skills` under MIT with the notice, licence text, and upstream commit retained. See ADR-0006.
- Five verified Agents: `claude-code`, `codex`, `github-copilot`, `opencode`, `pi`. Project and user-level directories per Agent, honouring each Agent's own configuration-directory environment overrides.
- `codex`, `github-copilot`, and `opencode` share the same project directory, so one project install serves all three; the resolved directory is echoed with the Agents it covers. `pi` uses different suffixes for the two Scopes and is the entry most easily got wrong.
- No per-Agent content rewriting is implemented. Upstream has none of this in its table — it is special-cased for a single Agent we do not support — so the transform mechanism is not built.
- Agent detection is not implemented. Installing prompts for Agent and Scope, with flags for non-interactive use, and errors rather than defaulting when there is no terminal and no flags.
- The Skill name is sanitised before it is used as a directory name, and extraction enforces the structural limits and path rules in full. This is where a hostile Artifact is actually stopped — the API never inspected it.

### Deployment

- Compose ships the application and Postgres 18. Object storage is supplied by the operator.
- Configuration: database URL, bucket, region, storage credentials, signing secret, port. The application refuses to start without a signing secret rather than generating one.
- Migrations run at startup, guarded by an advisory lock so that a future multi-replica deployment cannot corrupt the schema.

## Testing Decisions

A good test here states a rule from the sections above and checks it through a public surface: a request in, a response and a database or storage effect out. Tests name domain terms — Skill, Artifact, Token, Agent, Scope — and never reach for a module's internals, a private function, or the shape of an intermediate value. If a test has to be rewritten because a module was reorganised without any behaviour changing, it was testing the wrong thing.

There is no prior art: the repository is empty and these are the first tests in it. The three seams below are the ones to establish, and later work should reuse them rather than adding more.

**Seam 1 — the API request boundary.** The API is a function from a request to a response, so tests call it directly with no server listening, against a real Postgres and a fake storage adapter. This covers almost every rule in this spec: bootstrap signup and its closure, login, forced password change, session and Token authentication, per-request role resolution, the permission matrix, the last-Admin rule, metadata validation, replacement semantics, listing order and pagination, full-text search, presigned upload and download issuance, deletion, User management, and Token minting and revocation. Use a real database rather than a fake — the generated search column, the unique constraint on email, and the primary key on Skill name are the behaviour under test, not incidental detail.

**Seam 2 — the shared publishing pipeline.** Pure functions with no input or output: a set of files in, validated metadata and an Artifact out; an Artifact in, a safe extraction plan out. Every validation rule is a table-driven case here — name boundaries, description length, missing `SKILL.md`, tolerated wrapping directory, ambiguous layouts, exclusion of non-Skill files, path traversal, absolute paths, symlinks, entry count, and uncompressed size. This seam is not optional and not merely convenient: because the API never inspects an Artifact (ADR-0001), it is the only place the security-relevant rules are covered at all. It also makes the web interface publish path testable without a browser harness, since that path is this pipeline plus two network calls.

**Seam 3 — the CLI command layer.** Commands invoked in process with an injected HTTP client and a temporary filesystem, never by spawning a subprocess. Covers the discovery walk and its depth cap and exclusions, not descending into a discovered Skill, validate-everything-then-abort, the multi-Skill confirmation and its bypass flag, per-Skill reporting, Agent and Scope resolution across all five Agents and both Scopes including environment overrides and the shared project directory, extraction refusing a hostile Artifact, identity reporting, and configuration versus environment precedence.

The web interface gets no seam of its own. Given seam 2 it is glue — a file input, the pipeline, two network calls — and a component harness would exercise the archiving library and the fetch API rather than any decision in this spec. The storage adapter is faked at seams 1 and 3; a single contract test against real S3 may exist but is not part of the normal suite.

## Out of Scope

- Categories or tags on Skills, and therefore filtering or listing by them.
- Version history for a Skill. Publishing replaces; recovery is bucket versioning (ADR-0002).
- Namespacing. Skill names are flat and global within a Registry.
- Ownership of a Skill, and any per-Skill permissions.
- Soft delete, restore, or a recycle bin.
- Renaming a Skill. Changing the name in frontmatter publishes a second Skill and leaves the first.
- Reconciling objects orphaned by an abandoned publish, and any handling of a row whose Artifact was never uploaded beyond an Admin deleting it.
- Recording an Artifact digest or size.
- Serving the Agent Skills discovery index, and therefore installation by any third-party tooling. Deferred rather than rejected (ADR-0003).
- Agents beyond the five verified ones, per-Agent content rewriting, and Agent detection.
- OIDC or any single-sign-on. The email identifier was chosen so that adding it later is additive.
- Sending email. Initial passwords are handed over by the Admin out of band.
- Authoring or editing a Skill in the browser.
- Browsing an Artifact file listing or reading individual files in the web interface.
- Uninstalling or updating an installed Skill from the CLI.
- Search ranking controls, filters, or saved searches. One search input, one result list.

## Further Notes

Three properties of this design look like defects to a reader who has not read the ADRs, and each has one:

- The API validates a claim about a Skill but never the Skill itself. Deliberate (ADR-0001). Moving validation server-side means changing the upload path too; they are one decision.
- Publishing overwrites with no history, and deletion is permanent. Deliberate (ADR-0002). Bucket versioning is the recovery path and must stay enabled.
- The Agent table is data copied from another project. Deliberate (ADR-0006), with attribution and the upstream commit recorded so that re-syncing is a diff.

Two known limits worth stating so they are not discovered as bugs. Full-text search stems rather than substring-matches, so a query will not match a longer word that contains it, and hyphenated names tokenise per word; a trigram index complements the search column if this becomes a problem. And because a Skill row is created before its Artifact exists, an abandoned publish leaves a Skill that lists and views but fails to download until an Admin deletes it.

The glossary has no term for the walk that discovers Skills under a path, nor for a row whose Artifact has not arrived. Both are worth naming if they turn out to need discussing.
