# Structuring `apps/api`: patterns from Hono codebases

This document compares how `apps/api` is organised today with how Hono's own guidance and several
popular open-source Hono APIs are organised. It then proposes a structure and an incremental way to
get there. It is written to help you decide, not to prescribe. Some of what exists today is already
a recognised Hono pattern, and the document says which parts.

## Sources

| Source | What it is | Why it is relevant |
|---|---|---|
| [Hono — Best Practices](https://hono.dev/docs/guides/best-practices) | The official guide | The rules everything below follows |
| [w3cj/hono-open-api-starter](https://github.com/w3cj/hono-open-api-starter) (~1k★) | The most-cited Hono + Drizzle + Zod + OpenAPI template | Feature folders, `createRouter()`/`createApp()`, generated OpenAPI |
| [usekaneo/kaneo](https://github.com/usekaneo/kaneo) (~9k★) | Self-hosted project management; **Hono + Drizzle + Postgres + Better Auth** | Closest match to this stack. One folder per feature |
| [openstatusHQ/openstatus](https://github.com/openstatusHQ/openstatus) `apps/server` | Status-page product | Also uses `registerX(app)` functions, but inside per-feature sub-apps. Has `require-scope` / `rate-limit` middleware |
| [honojs/middleware](https://github.com/honojs/middleware) | First-party middleware | `@hono/zod-validator`, `@hono/zod-openapi` |

---

## 1. What Hono recommends

From the best-practices guide:

1. **Don't write Rails-style controllers.** "You don't need to create RoR-like controllers and
   should write handlers directly after path definitions." A handler defined away from its route
   loses type inference for `c.req.param()`, `c.req.valid()` and `c.var`. If you do need a separate
   function, use `createFactory().createHandlers(...)`, which keeps the types.
2. **Grow with `app.route()`.** Each resource is its own `new Hono()` in its own file, mounted from
   the root: `app.route("/authors", authors)`.
3. **Chain routes if you want RPC.** `export type AppType = typeof routes`, and `hc<AppType>()` on
   the client gives end-to-end types. This only works if the routes are **chained** on the instance
   whose type is exported.

## 2. What the reference codebases do

**w3cj/hono-open-api-starter** — one folder per feature, three files each:

```
src/
  app.ts                     createApp() + .route() for every feature; exports AppType
  env.ts                     zod-parsed process.env
  lib/create-app.ts          createRouter() / createApp() / createTestApp()
  lib/configure-open-api.ts  /doc + Scalar UI
  middlewares/pino-logger.ts
  routes/tasks/
    tasks.routes.ts          createRoute({ method, path, request, responses })   — the contract
    tasks.handlers.ts        typed handlers (AppRouteHandler<typeof list>)
    tasks.index.ts           createRouter().openapi(routes.list, handlers.list)...
    tasks.test.ts            testClient(createTestApp(router))
```

`createApp()` is the one place the global middleware stack lives (`requestId()`, pino logger,
`notFound`, `onError`). `createTestApp(router)` gives each feature's tests a real app with that same
stack.

**Kaneo** (`apps/api/src`) — the same idea, arranged by domain:

```
column/
  index.ts          createRoute(...) definitions + apiRouter().openapi(route, handler) chain
  schema.ts         request zod schemas (params, bodies)
  response.ts       response zod schemas
  controllers/      one plain async function per use case (create-column.ts, ...)
database/ auth.ts openapi.ts index.ts utils/
```

Each handler is two or three lines. It reads `c.req.valid("param")` / `c.req.valid("json")` and
calls a plain function in `controllers/`. Authorisation is route-level middleware declared inside
`createRoute({ middleware: [...] })`, so the contract shows who can call each route.

**OpenStatus** (`apps/server/src/routes/v1/monitors/`) — one file per operation (`get.ts`, `post.ts`,
`delete.ts`, each exporting `registerGetMonitor(api)`), with a colocated `*.test.ts`. `index.ts`
creates the feature's `OpenAPIHono` and calls each register function. Cross-cutting concerns live
in `libs/middlewares/` (`auth.ts`, `require-scope.ts`, `rate-limit.ts`, `limits.ts`), and errors
live in `libs/errors/`.

**What they have in common:**

| Concern | Consensus |
|---|---|
| Grouping | **By feature** (vertical), not by layer |
| Mounting | Each feature is its own Hono sub-app, mounted with `.route(prefix, sub)` |
| Validation | `zValidator` / `@hono/zod-openapi` at the route; handlers only see typed, validated input |
| Contract | Route + schemas declared together; OpenAPI **generated** from them |
| Global stack | Built once in a `createApp()` factory: request id, logger, secure headers, CORS/CSRF, body limit, `onError`, `notFound` |
| Auth | Middleware; authorisation attached per route (or per sub-app via `.use()`) |
| Env | Parsed once with zod |
| Tests | Colocated per feature, against the real app via `app.request` / `testClient` |

---

## 3. How `apps/api` compares today

What already matches good practice:

- `createApp(deps)` is a composition root. Services are built once and injected, so there are no
  module-level singletons (Kaneo imports `db` globally, and the explicit version here is better).
- Config is validated at startup (`config.ts`).
- One central `onError` and a single error shape.
- `registerXRoutes(app, deps)` is essentially OpenStatus's `registerX(api)` pattern.
- Tests exercise the real app through `app.request`, backed by a real Postgres (testcontainers).
- Request and response schemas live in `packages/shared` and are shared with the web and CLI.

What makes it harder to scale:

| Symptom (today) | Why it hurts | Reference fix |
|---|---|---|
| Every feature mutates **one flat `api` instance** (`app.ts` comment: "routes aren't split across per-resource sub-apps") | Match order across features is global. `routes/resources.ts` and `routes/auth.ts` carry comments saying registration order is load-bearing (ISSUE-26.1). Middleware can't be scoped to a feature. No `AppType` | One sub-app per feature, `.route()`-mounted; constrain param shapes |
| Code is grouped **by layer**: `routes/`, `services/`, `http/errors.ts`, `db/schemas/` | Changing "tags" touches 4–5 folders; `http/errors.ts` is a 469-line list of every feature's errors | Group by feature; keep each feature's errors, schemas and tests in its folder |
| `requireAuth(deps), requireRole("admin")` repeated on almost every line | Easy to forget one; `deps` has to be threaded into every register function just for auth | `sub.use("*", requireAuth)` per sub-app; auth deps set once on the context |
| Mixed validation: `parseBody(c, Schema)` vs `readJsonObject(c)` + field checks inside services | Two error paths, untyped bodies for publish/tags, params never validated (services catch Postgres `22P02` instead) | `zValidator("param" \| "query" \| "json", Schema)` on every route |
| `docs/openapi.json` written by hand | Already missing three routes (ISSUE-26.4) | `@hono/zod-openapi` `createRoute` + `app.doc()` |
| No global middleware beyond `onError` | No request id, access log, secure headers, CSRF, body limit (ISSUE-8, 17, 19, 20) | One `createApp()` that installs the standard stack |
| Services throw HTTP errors and return HTTP-shaped values (presigned-upload envelopes, `SkillSchema`-shaped rows) | Services can't be reused outside HTTP without dragging `http/` along | Domain errors per feature; map them to status codes in one `onError` |

The conclusion is not that the current approach is wrong. **The register-function style is fine;
registering everything onto one flat app, and grouping by layer, are the parts that won't scale.**

---

## 4. Proposed structure

A vertical, feature-first layout. It follows the reference codebases and keeps this repo's good
parts (composition root, injected services, shared zod schemas):

```
apps/api/src/
  server.ts                    boot: config → db → migrate → createApp → Bun.serve (+ graceful shutdown)
  app.ts                       createApp(deps): global middleware, mounts features, exports AppType
  env.ts                       (today's config.ts)
  lib/
    factory.ts                 createFactory<AppEnv>() — typed Env shared by every feature
    validator.ts               zValidator wrapper that throws the repo's ValidationError shape
    errors.ts                  AppError base + onError/notFound handlers (small)
    logger.ts
  middleware/
    auth.ts                    requireAuth / requireRole / requireScope
    rate-limit.ts
  db/                          client, migrate, schemas/ (unchanged)
  storage/                     (unchanged)
  features/
    resources/
      resources.routes.ts      sub-app: routes + validators + handlers inline
      resources.service.ts     ResourcesService (today's services/resources.ts)
      resources.errors.ts      ResourceNotFoundError, ArtifactMissingError, ...
      artifact-files.ts        content-type / CSP policy for served files (ISSUE-1)
      resources.test.ts
    tags/ users/ tokens/ setup/ auth/ identity-providers/ integrations/ connections/ imports/ analytics/
```

### 4.1 One typed Env, set once

```ts
// lib/factory.ts
import { createFactory } from "hono/factory";
import type { UserRow } from "../db/schemas/index.js";
import type { Services } from "../app.js";

export type AppEnv = {
  Variables: {
    services: Services; // every service, built once in createApp
    user: UserRow;      // set by requireAuth
    requestId: string;
  };
};

export const factory = createFactory<AppEnv>();
export const createRouter = () => factory.createApp();
```

Services still come from the composition root. A single middleware puts them on the context,
instead of each `register*` function taking its own `deps` bag. Hono documents this
dependency-injection-through-`c.set` pattern, and it keeps the wiring in one place:

```ts
// app.ts
export function createApp(deps: AppDependencies) {
  const services = buildServices(deps);        // today's constructor block, unchanged
  const api = createRouter()
    .use(requestId())
    .use(pinoRequestLogger(deps.logger))
    .use(secureHeaders({ /* CSP etc — ISSUE-8 */ }))
    .use(bodyLimit({ maxSize: 1024 * 1024 }))  // ISSUE-20
    .use(csrf({ origin: deps.publicUrl }))     // ISSUE-17
    .use(async (c, next) => { c.set("services", services); await next(); })
    .route("/setup", setupRoutes)
    .route("/auth", authRoutes)
    .route("/users", usersRoutes)
    .route("/resources", resourcesRoutes)
    .route("/tags", tagsRoutes)
    .route("/identity-providers", identityProviderRoutes)
    .route("/integrations", integrationRoutes)
    .route("/connections", connectionRoutes)
    .route("/imports", importRoutes);

  api.onError(onError(deps.logger));
  api.notFound(notFoundJson);

  const app = new Hono().route("/api", api);
  if (deps.webRoot) mountSpa(app, deps.webRoot);
  return app;
}

export type AppType = ReturnType<typeof createApp>;
```

### 4.2 A feature router: routes, validation and handlers together

This is today's `routes/resources.ts`, restructured. Note what disappears: `requireAuth(deps)`
threaded into every route, `readJsonObject`, route-order comments, and the `22P02` catch in the
service.

```ts
// features/resources/resources.routes.ts
import { z } from "zod";
import { ResourceDirectoryQuerySchema, SkillPublishSchema, SkillSchema } from "@skillset/shared";
import { createRouter } from "../../lib/factory.js";
import { validate } from "../../lib/validator.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";

const IdParam = z.object({ id: z.uuid() });
const KindNameParam = z.object({ kind: KindSchema, name: z.string() });

export const resourcesRoutes = createRouter()
  // Public reads (ADR-0013)
  .get("/", validate("query", ResourceDirectoryQuerySchema), async (c) =>
    c.json(await c.var.services.resources.list(c.req.valid("query"))),
  )
  .get("/stats", async (c) => c.json(await c.var.services.resources.getStats()))
  // `{uuid}` regex: `/stats` can never be read as an id, whatever the order
  .get("/:id{[0-9a-fA-F-]{36}}", validate("param", IdParam), async (c) =>
    c.json(SkillSchema.parse(await c.var.services.resources.get(c.req.valid("param").id))),
  )
  // Writes
  .put(
    "/:kind/:name",
    requireAuth(),
    requireRole("writer"),
    validate("param", KindNameParam),
    validate("json", SkillPublishSchema), // one schema instead of validateSkill* per field
    async (c) => {
      const { kind, name } = c.req.valid("param");
      return c.json(await c.var.services.resources.publish(c.var.user, kind, name, c.req.valid("json")));
    },
  )
  .delete("/:id{[0-9a-fA-F-]{36}}", requireAuth(), requireRole("admin"), validate("param", IdParam), async (c) => {
    await c.var.services.resources.remove(c.req.valid("param").id);
    return c.body(null, 204);
  });
```

When a whole feature needs the same gate, apply it once:

```ts
export const integrationRoutes = createRouter()
  .use("*", requireAuth(), requireRole("admin"))
  .get("/", ...)
  .post("/", validate("json", IntegrationCreateSchema), ...);
```

### 4.3 Keep the repo's error shape with `zValidator`

```ts
// lib/validator.ts
import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { z } from "zod";
import { ValidationError } from "./errors.js";

export const validate = <T extends z.ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) =>
  zValidator(target, schema, (result) => {
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new ValidationError(issue?.message ?? "Invalid request.", issue?.path.join(".") || undefined);
    }
  });
```

`zValidator("json", …)` also rejects a body without `content-type: application/json`, which
closes the `text/plain` gap in ISSUE-17.

### 4.4 Middleware with `createMiddleware`, reading services from context

```ts
// middleware/auth.ts
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../lib/factory.js";

export const requireAuth = (opts?: { allowPendingPasswordChange?: boolean; sessionOnly?: boolean }) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const user = await c.var.services.auth.resolve(c.req.raw.headers, { sessionOnly: opts?.sessionOnly });
    if (!user) throw new UnauthenticatedError();
    if (user.must_change_password && !opts?.allowPendingPasswordChange) throw new PasswordChangeRequiredError();
    c.set("user", user);
    await next();
  });

export const requireScope = (scope: TokenScope) => createMiddleware<AppEnv>(/* ISSUE-6 */);
```

### 4.5 Errors: small base, per-feature subclasses, one mapper

Keep `AppError` (status + code) in `lib/errors.ts`, and move each feature's subclasses into
`features/<x>/<x>.errors.ts`. `onError` stays generic because every error carries its own status.
Hono's built-in `HTTPException` is the lighter alternative, but `AppError` already does the same job
and adds `code`/`field`, so keep it.

### 4.6 OpenAPI: generate it, don't write it

Kaneo and the w3cj starter both use `@hono/zod-openapi`: `createRoute({ method, path, request: { params, body }, responses })`
plus `app.openapi(route, handler)`, and serve the document with `app.doc("/api/openapi.json", …)`.
Since the zod schemas already live in `packages/shared`, this mostly means adding `.openapi()`
metadata, and it removes `docs/openapi.json` drift (ISSUE-26.4) for good. If that feels like too
much ceremony, `hono-openapi` (`describeRoute` + `resolver`) works on plain `Hono` with
`zValidator`, and is a smaller step from §4.2.

### 4.7 Optional: typed web client via RPC

With the routes chained (§4.1–4.2), `apps/web` could call `hc<AppType>("/api")` instead of
`apiFetch(path, Schema)`. That gives compile-time checking of paths, params and bodies. It is
optional: the shared-schema `apiFetch` already gives runtime safety. RPC types also get slow on very
large route trees; Hono's docs recommend splitting the client per feature (`hc<typeof usersRoutes>`)
when that happens.

### 4.8 Tests: colocate per feature, and keep the real DB

Keep the testcontainers harness (`test/setup.ts`). Move each `test/<x>.test.ts` next to its feature
as `features/<x>/<x>.test.ts`. Add a `createTestApp()` that uses the same `createApp()`, so tests run
with the production middleware stack (secure headers, CSRF, body limit) rather than a bare router.

---

## 5. Incremental migration plan

Each step ships on its own, and the existing 388 API tests keep passing at every step. None of them
changes the HTTP contract.

1. **Add the global stack** in `createApp`: `requestId`, request logger, `secureHeaders`,
   `bodyLimit`, `csrf`, JSON `notFound`. This directly fixes ISSUE-8/17/19/20.
2. **Introduce `lib/factory.ts` + the services-on-context middleware.** Make `requireAuth` read
   from `c.var.services`, and drop the `deps` parameter from each `register*` function.
3. **Add `lib/validator.ts`** and convert routes one feature at a time: params first (then delete
   `isInvalidIdSyntax` / `selectByIdOrUndefined` / the `z.uuid()` guards in services), then bodies.
   Replace `readJsonObject` + field-wise service validation with a `SkillPublishSchema` in `shared`.
4. **Turn each `registerXRoutes(api, deps)` into an exported sub-app** and `.route()`-mount it.
   Replace order-dependent paths with regex-constrained params. Remove the "registration order is
   load-bearing" comments once the tests prove they no longer matter.
5. **Move to feature folders** (`git mv routes/tags.ts services/tags.ts … features/tags/`) and split
   `http/errors.ts` per feature. This step is purely mechanical.
6. **Generate OpenAPI** (`@hono/zod-openapi` or `hono-openapi`) and delete `docs/openapi.json`.
7. *(Optional)* Export `AppType` and try `hc` in one web hook (`use-tags.ts` is the smallest).

## 6. Things not to copy

- **Global singletons** (`import db from "../database"` in Kaneo). Keep this repo's composition root
  and constructor injection. It is what makes the testcontainers harness simple.
- **One file per operation** (OpenStatus) for small features. It pays off when there are 15+
  operations on one resource. Here, one `x.routes.ts` per feature is enough, and it is what YAGNI
  suggests.
- **Controllers as a separate layer.** Hono's guide warns against it. Keep handlers inline and a
  couple of lines long, and put the logic in the service.
