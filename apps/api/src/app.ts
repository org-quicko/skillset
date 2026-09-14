import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serveStatic } from "hono/bun";
import { csrf } from "hono/csrf";
import { requestId } from "hono/request-id";
import type postgres from "postgres";
import type { Database } from "./db/client.js";
import { authRoutes } from "./features/auth/auth.routes.js";
import { connectionsRoutes } from "./features/connections/connections.routes.js";
import { identityProvidersRoutes } from "./features/identity-providers/identity-providers.routes.js";
import { importsRoutes } from "./features/imports/imports.routes.js";
import { integrationsRoutes } from "./features/integrations/integrations.routes.js";
import { resourcesRoutes } from "./features/resources/resources.routes.js";
import { setupRoutes } from "./features/setup/setup.routes.js";
import { tagsRoutes } from "./features/tags/tags.routes.js";
import { usersRoutes } from "./features/users/users.routes.js";
import { notFound, onError } from "./lib/errors.js";
import { createRouter } from "./lib/factory.js";
import type { Logger } from "./lib/logger.js";
import { trustedOrigins } from "./lib/origins.js";
import { clientIp } from "./middleware/client-ip.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { requestLog } from "./middleware/request-log.js";
import { securityHeaders, spaContentSecurityPolicy } from "./middleware/security-headers.js";
import { buildServices } from "./services.js";
import type { StorageAdapter } from "./storage/types.js";

/**
 * The largest request body the API accepts.
 *
 * @remarks
 * Bun's own default is 128 MB, and every JSON body here is read in full
 * before it is validated (ISSUE-20). The largest legitimate one is a publish:
 * a manifest of up to `ARTIFACT_MAX_ENTRIES` path/size pairs plus the whole
 * of `SKILL.md` as `body`. 2 MiB leaves room for both several times over
 * while putting a ceiling on what an unauthenticated caller can make this
 * process allocate. Artifact bytes do not pass through here at all — they go
 * straight to storage under a presigned URL (ADR-0001).
 */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * The general request limits, per client address.
 *
 * @remarks
 * The default is deliberately loose: the web interface fires several requests
 * per page and a `skillset add` run fires a few per Skill, so this is a
 * ceiling on a script, not a quota. The two overrides are the routes where one
 * request costs far more than a database read — assembling a zip reads every
 * file of an Artifact, and an import fans out to the Git provider's API on
 * this app's credentials. Better Auth limits its own routes separately, in
 * Postgres (features/auth/instance.ts).
 */
const RATE_LIMIT = {
  windowSeconds: 60,
  max: 600,
  overrides: [
    { prefix: "/api/imports", windowSeconds: 60, max: 60 },
    { prefix: "/api/resources", windowSeconds: 60, max: 300 },
  ],
};

export interface AppDependencies {
  sql: postgres.Sql;
  db: Database;
  /** Better Auth's signing secret (ADR-0016). */
  betterAuthSecret: string;
  /** Absolute base URL this Registry is reached at. Required (ADR-0016). */
  publicUrl: string;
  storage: StorageAdapter;
  logger: Logger;
  /** Absolute path to the built web interface's static assets, if any. */
  webRoot?: string;
  /**
   * Addresses of the proxies this app sits behind, if any. Empty means no
   * `x-forwarded-for` header is believed and the socket address is used
   * (ISSUE-7).
   */
  trustedProxies?: readonly string[];
  /**
   * Whether to limit request rates. Defaults to on; the test harness turns it
   * off, because a suite that signs in repeatedly from one address is exactly
   * what a credential limiter is built to refuse.
   */
  rateLimiting?: boolean;
  /**
   * The origin presigned upload URLs point at. The web interface uploads an
   * Artifact's files straight to storage (ADR-0001), so its
   * Content-Security-Policy has to allow that origin — see
   * `spaContentSecurityPolicy`.
   */
  storageOrigin?: string;
}

/**
 * Builds the API: every feature's routes under `/api`, sharing one set of
 * services, one error handler, and one middleware stack.
 *
 * @param deps - The database, storage adapter, signing secret, public URL, and logger.
 * @returns The API's router, before it is mounted under `/api`.
 */
function createApi(deps: AppDependencies) {
  const services = buildServices({ ...deps, rateLimiting: deps.rateLimiting !== false });

  const api = createRouter()
    .use(async (c, next) => {
      c.set("services", services);
      c.set("publicUrl", deps.publicUrl);
      await next();
    })
    .get("/health", async (c) => {
      await deps.sql`SELECT 1`;
      return c.json({ status: "ok" });
    })
    .route("/setup", setupRoutes)
    .route("/auth", authRoutes)
    .route("/identity-providers", identityProvidersRoutes)
    .route("/integrations", integrationsRoutes)
    .route("/connections", connectionsRoutes)
    .route("/imports", importsRoutes)
    .route("/users", usersRoutes)
    .route("/resources", resourcesRoutes)
    .route("/tags", tagsRoutes);

  // Registered before `app.route("/api", api)` below: Hono wraps a sub-app's
  // routes in its error handler at the moment the sub-app is mounted.
  api.onError(onError(deps.logger));
  return api;
}

/** The API's routes, for a typed client (`hc<ApiType>`) to be built against. */
export type ApiType = ReturnType<typeof createApi>;

/**
 * Builds the fully wired app: the API under `/api`, and — when a built web
 * interface is available — the web interface, with an SPA fallback.
 *
 * @param deps - The database, storage adapter, signing secret, public URL,
 * logger, and optional web interface root.
 * @returns `Hono`
 * @example
 * ```ts
 * const app = createApp({ sql, db, betterAuthSecret, publicUrl, storage, logger });
 * ```
 */
export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  // Before the routes, and on the plain `app` rather than the typed API
  // router: every one of these applies to the whole app, and each handler
  // added to the API's chained builder multiplies its per-route generic
  // inference — enough of them and `tsc` runs out of type instantiations.
  app.use("*", requestId(), clientIp(deps.trustedProxies ?? []), requestLog(deps.logger));
  app.use("*", securityHeaders(deps.publicUrl));
  if (deps.rateLimiting !== false) app.use("/api/*", rateLimit(RATE_LIMIT));
  app.use("/api/*", bodyLimit({ maxSize: MAX_BODY_BYTES }));
  // Custom routes accept the Better Auth session cookie and used to rely on
  // its `SameSite=Lax` default alone, which does not cover a sibling
  // subdomain or an older browser (ISSUE-17). Better Auth checks the origin
  // on its own routes; this is the same check for everything else.
  app.use("/api/*", csrf({ origin: trustedOrigins(deps.publicUrl) }));

  app.route("/api", createApi(deps));

  // Only an `/api` path that no route matched reaches here: every other miss
  // is either a static file or the SPA's own route.
  app.notFound((c) => (c.req.path.startsWith("/api/") ? notFound(c) : c.text("404 Not Found", 404)));

  if (deps.webRoot) {
    const webRoot = deps.webRoot;
    app.use("*", spaContentSecurityPolicy(deps.storageOrigin));
    // Serves real files under webRoot (including "/" -> index.html) and
    // falls through to the handler below for anything it can't find.
    app.use("*", serveStatic({ root: webRoot }));
    app.get("*", async (c, next) => {
      // A route under /api that didn't match above is a genuine 404, not a
      // client-side route — never mask it with the SPA shell.
      if (c.req.path.startsWith("/api/")) {
        return notFound(c);
      }
      // A miss with a file extension was a real static-asset request that
      // serveStatic already couldn't find (e.g. a stale hashed asset after a
      // redeploy) — a genuine 404, not a client-side route either.
      if (/\.[^/]+$/.test(c.req.path)) {
        return c.notFound();
      }
      return serveStatic({ root: webRoot, path: "index.html" })(c, next);
    });
  }

  return app;
}
