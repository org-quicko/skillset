# 16 — Give Skills, Users, and Tokens a stable id (uuidv7); route Skill reads/deletes/downloads by id

**What to build:** Skills currently use `name` as their primary key. Add a `uuidv7` `id` primary key to `skills`, and switch `users` and `tokens` from `gen_random_uuid()` (v4) to Postgres 18's native `uuidv7()` (this repo runs `postgres:18-alpine`). `name` stays unique on `skills`: it's still how a Skill is published — `PUT` is an upsert by name, since there's no `id` before the row exists — and it stays how the Artifact is keyed in storage. Reading a Skill, deleting it, and downloading its Artifact move to `{id}` in the API; the web keeps `/skills/<name>` in the browser's address bar and resolves `name → id` internally wherever the API now needs the id.

**Blocked by:** 12 — Delete a Skill (this changes the route ticket 12 built).

**Status:** ready-for-agent

- [ ] `skills.id` is a `uuid` primary key generated via Postgres's native `uuidv7()`; `name` remains a unique, non-null column with its existing format check.
- [ ] `users.id` and `tokens.id` switch their default from `gen_random_uuid()` to `uuidv7()`.
- [ ] `PUT /skills/{name}` is unchanged — publishing stays a name-keyed upsert (ADR-0002); a row's `id` is generated once, on first insert, and never changes across republishes of the same name.
- [ ] `GET /skills/{id}`, `DELETE /skills/{id}`, and `GET /skills/{id}/artifact` take the Skill's id, not its name.
- [ ] The Artifact's storage key stays `skills/<name>.zip` — unaffected by the id, resolved from the row's `name` after the id lookup.
- [ ] The Skill list (`GET /skills`) and the publish response (`PUT /skills/{name}`) include `id`, so the web has it without an extra round trip.
- [ ] The web interface keeps `/skills/<name>` as the browser URL for a Skill's detail page; it resolves `name → id` internally (from the already-loaded list row or detail response) wherever the API requires the id — reading the detail page, deleting, and downloading.
- [ ] `docs/openapi.json` and `docs/data-model.md` are updated to match.

GitHub issue: https://github.com/org-quicko/skill-registry/issues/16
