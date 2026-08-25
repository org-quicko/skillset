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
} from "@skill-registry/shared";
import type { Hono } from "hono";
import { requireAuth, requireRole, type AuthDependencies, type AuthVariables } from "../auth/middleware.js";
import { ValidationError } from "../http/errors.js";
import {
  createUser,
  deleteToken,
  deleteUser,
  listTokens,
  listUsers,
  mintToken,
  replaceOwnPassword,
  updateOwnName,
  updateUserRole,
  type UsersServiceDependencies,
} from "../services/users.js";

export interface UsersRouteDependencies extends AuthDependencies, UsersServiceDependencies {}

/**
 * Registers the `/users` routes: Admin management of every User, and each
 * User's own profile, password, and Tokens (list, mint, delete).
 *
 * @param app - The Hono app to register the routes on.
 * @param deps - The auth and Users-service dependencies the routes need.
 */
export function registerUsersRoutes(app: Hono<{ Variables: AuthVariables }>, deps: UsersRouteDependencies): void {
  app.get("/users", requireAuth(deps), requireRole("admin"), async (c) => {
    return c.json(UserPageSchema.parse(await listUsers(deps, c.req.query("page"))));
  });

  app.post("/users", requireAuth(deps), requireRole("admin"), async (c) => {
    const parsed = UserCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError("first_name, last_name, email, and role are required.");
    }

    const result = await createUser(deps, parsed.data);
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
    const parsed = UserUpdateNameSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError("first_name or last_name is required.");
    }

    const updated = await updateOwnName(deps, c.get("user"), parsed.data);
    return c.json(UserSchema.parse(updated));
  });

  app.put(
    "/users/me/password",
    // The route that resolves must_change_password — it has to be reachable
    // while that flag is still set (docs/data-model.md).
    requireAuth(deps, { allowPendingPasswordChange: true }),
    async (c) => {
      const parsed = PasswordReplaceSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        throw new ValidationError("current_password and new_password (at least 12 characters) are required.");
      }

      await replaceOwnPassword(deps, c.get("user"), parsed.data);
      return c.body(null, 204);
    },
  );

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

  app.patch("/users/:user_id", requireAuth(deps), requireRole("admin"), async (c) => {
    const parsed = UserRoleUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError("role is required.", "role");
    }

    const updated = await updateUserRole(deps, c.get("user"), c.req.param("user_id"), parsed.data.role);
    return c.json(UserSchema.parse(updated));
  });

  app.delete("/users/:user_id", requireAuth(deps), requireRole("admin"), async (c) => {
    await deleteUser(deps, c.get("user"), c.req.param("user_id"));
    return c.body(null, 204);
  });
}
