import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import type postgres from "postgres";
import { createAuthRegistry } from "./auth/instance.js";
import type { AuthVariables } from "./auth/middleware.js";
import type { Database } from "./db/client.js";
import { registerErrorHandler } from "./http/errors.js";
import type { Logger } from "./logger.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerGitHubRoutes } from "./routes/github.js";
import { registerIdentityProviderRoutes } from "./routes/identity-providers.js";
import { registerSetupRoutes } from "./routes/setup.js";
import { registerSkillsRoutes } from "./routes/skills.js";
import { registerTagsRoutes } from "./routes/tags.js";
import { registerUsersRoutes } from "./routes/users.js";
import { AnalyticsService } from "./services/analytics.js";
import { GitHubImportService } from "./services/github-import.js";
import { IdentityProvidersService } from "./services/identity-providers.js";
import { SetupService } from "./services/setup.js";
import { SkillsService } from "./services/skills.js";
import { TagsService } from "./services/tags.js";
import { UsersService } from "./services/users.js";
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
 * Builds the fully wired Hono app: constructs each service, mounts every
 * resource's routes under `/api`, registers the central error handler, and —
 * when a built web interface is available — serves it with an SPA fallback.
 *
 * @remarks
 * The composition root. Every service is constructed exactly once here and
 * handed only to the routes that use it, so a route module names the services
 * it depends on rather than receiving the whole application's dependencies.
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

  // One registry for the whole app, so every route shares the same cached
  // Better Auth instance and one Provider edit rebuilds it once (ADR-0019).
  const auth = createAuthRegistry({
    db: deps.db,
    secret: deps.betterAuthSecret,
    publicUrl: deps.publicUrl,
    logger: deps.logger,
  });

  const analytics = new AnalyticsService(deps.db, deps.logger);
  const tags = new TagsService(deps.db, deps.logger);
  const skills = new SkillsService(deps.db, deps.storage, deps.logger, tags, analytics);
  const users = new UsersService(deps.db, deps.logger);
  const setup = new SetupService(deps.db, deps.logger);
  const identityProviders = new IdentityProvidersService(deps.db, deps.logger);
  const githubImport = new GitHubImportService(deps.db, deps.betterAuthSecret, deps.logger);

  // What `requireAuth`/`requireRole` need, and nothing else — the role is
  // re-read from the database on every request (ADR-0005).
  const authDeps = { db: deps.db, auth };

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

  registerSetupRoutes(api, { setup, auth });
  registerAuthRoutes(api, { identityProviders, auth });
  registerIdentityProviderRoutes(api, { ...authDeps, identityProviders });
  registerGitHubRoutes(api, { ...authDeps, githubImport });
  registerUsersRoutes(api, { ...authDeps, users });
  registerSkillsRoutes(api, { ...authDeps, skills, tags });
  registerTagsRoutes(api, { ...authDeps, tags });

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
