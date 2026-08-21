# 01 — Walking skeleton

**What to build:** An operator can bring the Registry up with a single compose command and get a running, empty Registry. Nothing is user-facing yet — this is the frame every later ticket hangs on, and the point is that the frame is verifiable rather than assumed.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] One compose command starts the application and Postgres 18, and the application waits for the database to be ready before serving.
- [ ] Migrations run at startup, guarded by an advisory lock, and are idempotent across restarts.
- [ ] The application refuses to start when the signing secret is missing, naming it in the failure rather than generating one.
- [ ] Configuration comes from the documented environment: database location, bucket, region, storage credentials, signing secret, port.
- [ ] A single process serves both the API and the built web interface from the same origin.
- [ ] The web interface is a React single-page application with Tailwind CSS, shadcn/ui initialised, and a server-state provider in place; one shadcn component renders to prove the pipeline end to end.
- [ ] The storage adapter contract is declared in full — put, get, exists, delete, list by prefix, presign for upload, presign for download — with a fake implementation for tests. The S3 implementation arrives in ticket 03.
- [ ] The API test harness calls the application directly, with no server listening, against a real Postgres and the fake storage adapter, and at least one test passes through it.
