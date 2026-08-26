import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import type postgres from "postgres";
import type { AuthVariables } from "./auth/middleware.js";
import type { Database } from "./db/client.js";
import { registerErrorHandler } from "./http/errors.js";
import type { Logger } from "./logger.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerSetupRoutes } from "./routes/setup.js";
import { registerSkillsRoutes } from "./routes/skills.js";
import { registerTagsRoutes } from "./routes/tags.js";
import { registerUsersRoutes } from "./routes/users.js";
import type { StorageAdapter } from "./storage/types.js";

export interface AppDependencies {
  sql: postgres.Sql;
  db: Database;
  jwtSecret: string;
  storage: StorageAdapter;
  logger: Logger;
  /** Absolute path to the built web interface's static assets, if any. */
  webRoot?: string;
}

/**
 * Builds the fully wired Hono app: mounts every resource's routes under
 * `/api`, registers the central error handler, and — when a built web
 * interface is available — serves it with an SPA fallback.
 *
 * @param deps - The database, storage adapter, JWT secret, logger, and
 * optional web interface root every route and service needs.
 * @returns `Hono`
 * @example
 * ```ts
 * const app = createApp({ sql, db, jwtSecret, storage, logger });
 * ```
 */
export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  // One shared app that each resource's register function mutates in place
  // — routes aren't split across per-resource sub-apps composed with
  // `.route()`, so there's a single place a request for a given path is
  // ever matched.
  const api = new Hono<{ Variables: AuthVariables }>();
  registerErrorHandler(api, deps.logger);

  api.get("/health", async (c) => {
    await deps.sql`SELECT 1`;
    return c.json({ status: "ok" });
  });

  registerSetupRoutes(api, deps);
  registerAuthRoutes(api, deps);
  registerUsersRoutes(api, deps);
  registerSkillsRoutes(api, deps);
  registerTagsRoutes(api, deps);

  app.route("/api", api);

  if (deps.webRoot) {
    const webRoot = deps.webRoot;
    // Serves real files under webRoot (including "/" -> index.html) and
    // falls through to the handler below for anything it can't find.
    app.use("*", serveStatic({ root: webRoot }));
    app.get("*", async (c, next) => {
      // A route under /api that didn't match above is a genuine 404, not a
      // client-side route — never mask it with the SPA shell.
      if (c.req.path.startsWith("/api/")) {
        return c.notFound();
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
