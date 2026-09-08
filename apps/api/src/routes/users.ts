import {
  PasswordReplaceSchema,
  TokenCreatedSchema,
  TokenMintSchema,
  TokenSchema,
  UserCreatedSchema,
  UserCreateSchema,
  UserPageSchema,
  UserRoleUpdateSchema,
  UserSchema,
  UserUpdateNameSchema,
} from "@skillset/shared";
import type { Hono } from "hono";
import { requireAuth, requireRole, type AuthDependencies, type AuthVariables } from "../auth/middleware.js";
import { parseBody } from "../http/body.js";
import type { UsersService } from "../services/users.js";

export type UsersRouteDependencies = AuthDependencies & { users: UsersService };

/**
 * Registers the `/users` routes: Admin management of every User, and each
 * User's own profile, password, and Tokens (list, mint, delete).
 *
 * @param app - The Hono app to register the routes on.
 * @param deps - The auth dependencies and the Users service.
 */
export function registerUsersRoutes(app: Hono<{ Variables: AuthVariables }>, deps: UsersRouteDependencies): void {
  app.get("/users", requireAuth(deps), requireRole("admin"), async (c) => {
    return c.json(UserPageSchema.parse(await deps.users.list(c.req.query("page"))));
  });

  app.post("/users", requireAuth(deps), requireRole("admin"), async (c) => {
    const input = await parseBody(c, UserCreateSchema, "first_name, last_name, email, and role are required.");
    const result = await deps.users.create(input);
    return c.json(UserCreatedSchema.parse(result), 201);
  });

  app.get(
    "/users/me",
    // Allowed while a generated password is still pending replacement — it
    // is how the caller (and the CLI) tells that state apart from a
    // rejected credential (docs/data-model.md).
    requireAuth(deps, { allowPendingPasswordChange: true }),
    async (c) => {
      // The role on this row was resolved fresh for this request by
      // requireAuth, not read from the session token (ADR-0005).
      return c.json(UserSchema.parse(c.get("user")));
    },
  );

  app.patch("/users/me", requireAuth(deps), async (c) => {
    const input = await parseBody(c, UserUpdateNameSchema, "first_name or last_name is required.");
    const updated = await deps.users.updateOwnName(c.get("user"), input);
    return c.json(UserSchema.parse(updated));
  });

  app.put(
    "/users/me/password",
    // The route that resolves must_change_password — it has to be reachable
    // while that flag is still set (docs/data-model.md).
    requireAuth(deps, { allowPendingPasswordChange: true }),
    async (c) => {
      const input = await parseBody(
        c,
        PasswordReplaceSchema,
        "current_password and new_password (at least 12 characters) are required.",
      );
      await deps.users.replaceOwnPassword(c.get("user"), input);
      return c.body(null, 204);
    },
  );

  // Nested under the owner because a User may only ever manage their own
  // Tokens (spec, "Shape") — every query is scoped by the authenticated
  // User's id, never by a Token id alone.

  app.get("/users/me/tokens", requireAuth(deps), async (c) => {
    const rows = await deps.users.listTokens(c.get("user"));
    return c.json(rows.map((row) => TokenSchema.parse(row)));
  });

  app.post("/users/me/tokens", requireAuth(deps), async (c) => {
    const input = await parseBody(c, TokenMintSchema, "name is required.");
    const { token, secret } = await deps.users.mintToken(c.get("user"), input.name);
    return c.json(TokenCreatedSchema.parse({ ...token, secret }), 201);
  });

  app.delete("/users/me/tokens/:token_id", requireAuth(deps), async (c) => {
    await deps.users.deleteToken(c.get("user"), c.req.param("token_id"));
    return c.body(null, 204);
  });

  app.patch("/users/:user_id", requireAuth(deps), requireRole("admin"), async (c) => {
    const input = await parseBody(c, UserRoleUpdateSchema, "role is required.");
    const updated = await deps.users.updateRole(c.get("user"), c.req.param("user_id"), input.role);
    return c.json(UserSchema.parse(updated));
  });

  app.delete("/users/:user_id", requireAuth(deps), requireRole("admin"), async (c) => {
    await deps.users.remove(c.get("user"), c.req.param("user_id"));
    return c.body(null, 204);
  });
}
