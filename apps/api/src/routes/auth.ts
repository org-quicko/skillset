import { LoginSchema, PublicIdentityProviderListSchema, UserSchema } from "@skill-registry/shared";
import type { Context, Hono } from "hono";
import { requireAuth, type AuthVariables } from "../auth/middleware.js";
import { clearFlowCookie, decodeFlow, readFlowCookie, setFlowCookie } from "../auth/oidc-state.js";
import { clearSessionCookie, setSessionCookie } from "../auth/session.js";
import { AppError, ExternalLoginFailedError, ValidationError } from "../http/errors.js";
import { login, type AuthServiceDependencies } from "../services/auth.js";
import {
  listEnabledIdentityProviders,
  type IdentityProvidersServiceDependencies,
} from "../services/identity-providers.js";
import { completeExternalLogin, startExternalLogin, type OidcServiceDependencies } from "../services/oidc.js";

export interface AuthRouteDependencies
  extends AuthServiceDependencies,
    OidcServiceDependencies,
    IdentityProvidersServiceDependencies {}

/** Where a browser is sent when a login through a Provider cannot be completed. */
const LOGIN_PATH = "/login";

/**
 * Sends a failed external login back to the login page rather than to a JSON
 * error body: every route below is reached by a browser following a redirect,
 * not by `fetch`, so an error response would be rendered as raw JSON.
 *
 * The URL carries only a coarse code, and every security check collapses into
 * the same one — a bad nonce, an unverified email, and the wrong hosted domain
 * are indistinguishable to the caller, because the person at the other end can
 * act no differently whichever it was and naming it would tell an attacker
 * which check they tripped. `public_url_not_configured` is the one code that
 * does travel, and deliberately: it is a misconfiguration nobody can work
 * around by guessing, and the login page turns it into an instruction for
 * whoever runs the Registry.
 *
 * Which check actually failed goes to the logs, as `reason`, and only there.
 */
function failedLogin(c: Context, deps: AuthRouteDependencies, error: unknown): Response {
  const code = error instanceof AppError ? error.code : "external_login_failed";
  // Logged as its own field rather than left to the error serializer, which is
  // not obliged to carry a subclass's extra properties.
  const reason = error instanceof ExternalLoginFailedError ? error.reason : undefined;
  deps.logger.warn({ err: error, code, reason }, "external login failed");
  clearFlowCookie(c);
  return c.redirect(`${LOGIN_PATH}?error=${encodeURIComponent(code)}`, 302);
}

/**
 * Registers the authentication routes: password login and logout, the login
 * page's list of Identity Providers, and the two halves of an external login.
 *
 * @remarks
 * Both external-login routes are unauthenticated, as they must be — they are
 * how someone who has no session gets one. There is one callback path for
 * every Provider, not one per Provider: which Provider a response belongs to
 * is carried in `state` and checked against a cookie (ADR-0015), so a
 * deployment registers a single redirect URI per provider console.
 *
 * @param app - The Hono app to register the routes on.
 * @param deps - The auth, OIDC, and Identity-Provider-service dependencies.
 */
export function registerAuthRoutes(app: Hono<{ Variables: AuthVariables }>, deps: AuthRouteDependencies): void {
  app.post("/auth/login", async (c) => {
    const parsed = LoginSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError("email and password are required.");
    }

    const { user, token } = await login(deps, parsed.data);
    setSessionCookie(c, token);
    return c.json(UserSchema.parse(user), 200);
  });

  app.post(
    "/auth/logout",
    // Ending a session is never blocked by a pending password change — the
    // must-change-password gate stops a User from doing anything else with
    // the session, not from giving it up (docs/data-model.md doesn't list
    // this among the routes it refuses, and refusing it would leave no way
    // to abandon a session started with a mistyped generated password).
    requireAuth(deps, { allowPendingPasswordChange: true }),
    async (c) => {
      clearSessionCookie(c);
      return c.body(null, 204);
    },
  );

  // Unauthenticated, and deliberately so: this is what a signed-out visitor
  // reads to know which buttons to draw. Enabled Providers only, and never a
  // field that could carry a secret (ADR-0013).
  app.get("/auth/providers", async (c) => {
    const items = await listEnabledIdentityProviders(deps);
    return c.json(PublicIdentityProviderListSchema.parse({ items }));
  });

  app.get("/auth/providers/:slug/start", async (c) => {
    try {
      const { authorizationUrl, flow } = await startExternalLogin(
        deps,
        c.req.param("slug"),
        c.req.query("destination"),
      );
      // Set before redirecting: the cookie, not the `state` travelling through
      // the provider, is what the callback trusts.
      setFlowCookie(c, flow);
      return c.redirect(authorizationUrl.href, 302);
    } catch (error) {
      return failedLogin(c, deps, error);
    }
  });

  app.get("/auth/callback", async (c) => {
    const flow = readFlowCookie(c);
    if (!flow) {
      return failedLogin(c, deps, new Error("No in-progress login for this browser."));
    }

    // The Provider named in the returned `state` must be the one this browser
    // started against, or a flow begun against one Provider could be completed
    // against another (ADR-0015). `completeExternalLogin` enforces the same
    // thing again by rebuilding the whole expected `state` from this cookie;
    // checking the slug here first is what makes the rule legible, and fails a
    // mismatched flow before a token is ever exchanged for it.
    const returned = decodeFlow(c.req.query("state"));
    if (!returned || returned.provider !== flow.provider) {
      return failedLogin(c, deps, new Error("The returned state does not match this browser's login."));
    }

    try {
      const { user, token, destination } = await completeExternalLogin(deps, flow, c.req.query());
      clearFlowCookie(c);
      setSessionCookie(c, token);
      deps.logger.info({ user_id: user.id, identity_provider: flow.provider }, "external login completed");
      return c.redirect(destination, 302);
    } catch (error) {
      return failedLogin(c, deps, error);
    }
  });
}
