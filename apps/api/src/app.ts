import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import type postgres from "postgres";
import type { StorageAdapter } from "./storage/types.js";

export interface AppDependencies {
  sql: postgres.Sql;
  storage: StorageAdapter;
  /** Absolute path to the built web interface's static assets, if any. */
  webRoot?: string;
}

export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  const api = new Hono();
  api.get("/health", async (c) => {
    await deps.sql`SELECT 1`;
    return c.json({ status: "ok" });
  });

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
