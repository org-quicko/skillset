import { ConnectionListSchema } from "@skillset/shared";
import type { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { requireAuth, requireRole, type AuthDependencies, type AuthVariables } from "../auth/middleware.js";
import type { ConnectionsService } from "../services/connections.js";

export type ConnectionRouteDependencies = AuthDependencies & {
  connections: ConnectionsService;
  /** Absolute base URL this Registry is reached at, for the post-callback redirect. */
  publicUrl: string;
};

/**
 * The cookie carrying the connect flow's nonce.
 *
 * @remarks
 * `SameSite=Lax` is required rather than chosen: the callback arrives as a
 * top-level GET navigation from the provider, and `Strict` would withhold the
 * cookie on exactly that request, breaking every connection attempt.
 */
const STATE_COOKIE = "skillset_connection_state";

/** Where a writer lands once the callback is done, successfully or not. */
const SETTINGS_PATH = "/settings";

/**
 * Registers the `/connections` routes: a writer's own grants of repository
 * access, and the OAuth dance that produces one (ADR-0024).
 *
 * @remarks
 * All four require `writer`. Importing exists to publish, and a reader cannot
 * publish — so offering them a connect action would invite them to grant a
 * credential they could never use.
 *
 * The callback is a `GET` because that is how the provider redirects back. It
 * is protected by the signed, single-use state rather than by being a POST,
 * and `requireAuth` still applies: the redirect carries the writer's session
 * cookie, which is what lets the state be checked against them.
 *
 * @param app - The Hono app to register the routes on.
 * @param deps - The auth dependencies, the Connections service, and the public URL.
 */
export function registerConnectionRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  deps: ConnectionRouteDependencies,
): void {
  const secure = deps.publicUrl.startsWith("https://");

  app.get("/connections", requireAuth(deps), requireRole("writer"), async (c) => {
    const [items, connectable] = await Promise.all([
      deps.connections.listForUser(c.get("user").id),
      deps.connections.connectableProviders(),
    ]);
    return c.json(ConnectionListSchema.parse({ items, connectable }));
  });

  app.get("/connections/:provider/start", requireAuth(deps), requireRole("writer"), async (c) => {
    const { redirect_to, nonce } = await deps.connections.start(
      c.get("user"),
      c.req.param("provider"),
      c.req.query("integration_id"),
    );

    setCookie(c, STATE_COOKIE, nonce, {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/api/connections",
      maxAge: 300,
    });
    return c.redirect(redirect_to, 302);
  });

  app.get("/connections/:provider/callback", requireAuth(deps), requireRole("writer"), async (c) => {
    const provider = c.req.param("provider");
    const nonce = getCookie(c, STATE_COOKIE);

    // Cleared before the attempt is judged, and on every path out of here.
    // That is what burns the state: a replay of the same callback arrives with
    // nothing to match.
    deleteCookie(c, STATE_COOKIE, { path: "/api/connections", secure });

    const code = c.req.query("code");
    const setupAction = c.req.query("setup_action");

    // A provider whose Setup URL points here fires it after an installation or
    // a repository-access change, carrying `setup_action` and no code. Nothing
    // was authorized and nothing is wrong, so the writer lands back in
    // settings. Refusing this is what made a successful repository change look
    // like a failed connection attempt.
    if (!code && setupAction) {
      return c.redirect(new URL(`${SETTINGS_PATH}?repositories=${provider}`, deps.publicUrl).href, 302);
    }

    await deps.connections.complete(c.get("user"), provider, {
      code,
      state: c.req.query("state"),
      nonce,
      error: c.req.query("error"),
    });

    return c.redirect(new URL(`${SETTINGS_PATH}?connected=${provider}`, deps.publicUrl).href, 302);
  });

  app.delete("/connections/:provider", requireAuth(deps), requireRole("writer"), async (c) => {
    await deps.connections.disconnect(c.get("user").id, c.req.param("provider"));
    return c.body(null, 204);
  });
}
