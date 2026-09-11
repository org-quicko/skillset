import { Hono } from "hono";
import { serveStatic } from "hono/bun";
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
import { buildServices } from "./services.js";
import type { StorageAdapter } from "./storage/types.js";

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
}

/**
 * Builds the API: every feature's routes under `/api`, sharing one set of
 * services, one error handler, and one middleware stack.
 *
 * @param deps - The database, storage adapter, signing secret, public URL, and logger.
 * @returns The API's router, before it is mounted under `/api`.
 */
function createApi(deps: AppDependencies) {
  const services = buildServices(deps);

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
  app.route("/api", createApi(deps));

  // Only an `/api` path that no route matched reaches here: every other miss
  // is either a static file or the SPA's own route.
  app.notFound((c) => (c.req.path.startsWith("/api/") ? notFound(c) : c.text("404 Not Found", 404)));

  if (deps.webRoot) {
    const webRoot = deps.webRoot;
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
