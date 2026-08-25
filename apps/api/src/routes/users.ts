import { TokenCreatedSchema, TokenMintSchema, TokenSchema, UserSchema } from "@skill-registry/shared";
import type { Hono } from "hono";
import { requireAuth, type AuthDependencies, type AuthVariables } from "../auth/middleware.js";
import { ValidationError } from "../http/errors.js";
import { deleteToken, listTokens, mintToken, type UsersServiceDependencies } from "../services/users.js";

export interface UsersRouteDependencies extends AuthDependencies, UsersServiceDependencies {}

/**
 * Registers the `/users/me` routes: the caller's own profile and their
 * Tokens (list, mint, delete).
 *
 * @param app - The Hono app to register the routes on.
 * @param deps - The auth and Users-service dependencies the routes need.
 */
export function registerUsersRoutes(app: Hono<{ Variables: AuthVariables }>, deps: UsersRouteDependencies): void {
  app.get("/users/me", requireAuth(deps), async (c) => {
    // The role on this row was resolved fresh for this request by
    // requireAuth, not read from the session token (ADR-0005).
    return c.json(UserSchema.parse(c.get("user")));
  });

  // Nested under the owner because a User may only ever manage their own
  // Tokens (spec, "Shape") — every query is scoped by the authenticated
  // User's id, never by a Token id alone.

  app.get("/users/me/tokens", requireAuth(deps), async (c) => {
    const rows = await listTokens(deps, c.get("user"));
    return c.json(rows.map((row) => TokenSchema.parse(row)));
  });

  app.post("/users/me/tokens", requireAuth(deps), async (c) => {
    const parsed = TokenMintSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError("name is required.", "name");
    }

    const { token, secret } = await mintToken(deps, c.get("user"), parsed.data.name);
    return c.json(TokenCreatedSchema.parse({ ...token, secret }), 201);
  });

  app.delete("/users/me/tokens/:token_id", requireAuth(deps), async (c) => {
    await deleteToken(deps, c.get("user"), c.req.param("token_id"));
    return c.body(null, 204);
  });
}
