import { ConnectionListSchema } from "@in-org-quicko/skillset-shared";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { createRouter } from "../../lib/factory.js";
import { validate } from "../../lib/validator.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { ConnectionDeclinedError } from "./connections.errors.js";

/**
 * The cookie carrying the connect flow's nonce.
 *
 * @remarks
 * `SameSite=Lax` is required rather than chosen: the callback arrives as a
 * top-level GET navigation from the provider, and `Strict` would withhold the
 * cookie on exactly that request, breaking every connection attempt.
 */
const STATE_COOKIE = "skillset_connection_state";
const STATE_COOKIE_PATH = "/api/connections";

/** Where a writer lands once the callback is done, successfully or not. */
const SETTINGS_PATH = "/settings/connected-accounts";

const StartQuerySchema = z.object({ integration_id: z.string().optional() });

const CallbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  setup_action: z.string().optional(),
});

/**
 * `/connections`: a writer's own grants of repository access, and the OAuth
 * dance that produces one (ADR-0024).
 *
 * @remarks
 * All of it requires `writer`: importing exists to publish, and a reader
 * cannot publish, so offering them a connect action would invite them to grant
 * a credential they could never use.
 *
 * The callback is a `GET` because that is how the provider redirects back. It
 * is protected by the signed, single-use state rather than by being a POST, and
 * the redirect carries the writer's session cookie, which is what lets the
 * state be checked against them.
 */
export const connectionsRoutes = createRouter()
  .use(requireAuth(), requireRole("writer"))
  .get("/", async (c) => {
    const { connections } = c.var.services;
    const [items, connectable] = await Promise.all([
      connections.listForUser(c.var.user.id),
      connections.connectableProviders(),
    ]);
    return c.json(ConnectionListSchema.parse({ items, connectable }));
  })
  .get("/:provider/start", validate("query", StartQuerySchema), async (c) => {
    const { redirect_to, nonce } = await c.var.services.connections.start(
      c.var.user,
      c.req.param("provider"),
      c.req.valid("query").integration_id,
    );

    setCookie(c, STATE_COOKIE, nonce, {
      httpOnly: true,
      secure: c.var.publicUrl.startsWith("https://"),
      sameSite: "Lax",
      path: STATE_COOKIE_PATH,
      maxAge: 300,
    });
    return c.redirect(redirect_to, 302);
  })
  .get("/:provider/callback", validate("query", CallbackQuerySchema), async (c) => {
    const provider = c.req.param("provider");
    const { code, state, error, setup_action } = c.req.valid("query");
    const nonce = getCookie(c, STATE_COOKIE);

    // Cleared before the attempt is judged, and on every path out of here.
    // That is what burns the state: a replay of the same callback arrives with
    // nothing to match.
    deleteCookie(c, STATE_COOKIE, { path: STATE_COOKIE_PATH, secure: c.var.publicUrl.startsWith("https://") });

    // A provider whose Setup URL points here fires it after an installation or
    // a repository-access change, carrying `setup_action` and no code. Nothing
    // was authorized and nothing is wrong, so the writer lands back in
    // settings. Refusing this is what made a successful repository change look
    // like a failed connection attempt.
    if (!code && setup_action) {
      return c.redirect(new URL(`${SETTINGS_PATH}?repositories=${provider}`, c.var.publicUrl).href, 302);
    }

    try {
      await c.var.services.connections.complete(c.var.user, provider, { code, state, nonce, error });
    } catch (err) {
      // A writer who clicks "Cancel" at the provider made a decision, not a
      // failed or forged attempt — its own outcome, told apart from every
      // other failure below.
      if (err instanceof ConnectionDeclinedError) {
        return c.redirect(new URL(`${SETTINGS_PATH}?declined=${provider}`, c.var.publicUrl).href, 302);
      }
      // Everything else `complete` throws (a tampered or missing state, an
      // Integration that has gone away, an exchange the provider refused) is
      // still a top-level navigation, not an API caller that can read a JSON
      // body — the generic error response answers with is unreachable here.
      // The message travels in the query string rather than being duplicated
      // as a second, separately-maintained copy on the frontend.
      if (err instanceof AppError) {
        const url = new URL(SETTINGS_PATH, c.var.publicUrl);
        url.searchParams.set("connection_error", err.message);
        return c.redirect(url.href, 302);
      }
      throw err;
    }

    return c.redirect(new URL(`${SETTINGS_PATH}?connected=${provider}`, c.var.publicUrl).href, 302);
  })
  .delete("/:provider", async (c) => {
    await c.var.services.connections.disconnect(c.var.user.id, c.req.param("provider"));
    return c.body(null, 204);
  });
