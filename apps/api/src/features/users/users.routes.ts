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
} from "@in-org-quicko/sqillset-shared";
import { z } from "zod";
import { createRouter } from "../../lib/factory.js";
import { uuidParam, validate } from "../../lib/validator.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { TokenNotFoundError, UserNotFoundError } from "./users.errors.js";

const PageQuery = z.object({ page: z.string().optional() });

/**
 * `/users`: Admin management of every User, and each User's own profile,
 * password, and Tokens.
 *
 * @remarks
 * Tokens are nested under `/users/me` because a User only ever manages their
 * own (spec, "Shape"); every Token query is scoped by the caller's id.
 */
export const usersRoutes = createRouter()
  .get("/", requireAuth(), requireRole("admin"), validate("query", PageQuery), async (c) => {
    return c.json(UserPageSchema.parse(await c.var.services.users.list(c.req.valid("query").page)));
  })
  .post(
    "/",
    requireAuth(),
    requireRole("admin"),
    validate("json", UserCreateSchema, "first_name, last_name, email, and role are required."),
    async (c) => {
      const result = await c.var.services.users.create(c.var.user, c.req.valid("json"));
      return c.json(UserCreatedSchema.parse(result), 201);
    },
  )
  // Reachable while a generated password is pending replacement: it is how
  // the web and CLI tell that state apart from a rejected credential.
  .get("/me", requireAuth({ allowPendingPasswordChange: true }), async (c) => {
    return c.json(UserSchema.parse(c.var.user));
  })
  .patch("/me", requireAuth(), validate("json", UserUpdateNameSchema, "first_name or last_name is required."), async (c) => {
    const updated = await c.var.services.users.updateOwnName(c.var.user, c.req.valid("json"));
    return c.json(UserSchema.parse(updated));
  })
  // The route that resolves `must_change_password`, so it must be reachable
  // while that flag is set.
  .put(
    "/me/password",
    requireAuth({ allowPendingPasswordChange: true }),
    validate("json", PasswordReplaceSchema, "current_password and new_password (at least 12 characters) are required."),
    async (c) => {
      // The session making the request is the one kept alive. A request
      // authenticated by a Token has none, and passes `undefined` — which
      // revokes every session, the right answer when the password was
      // replaced by something that is not a browser.
      const credential = c.var.credential;
      await c.var.services.users.replaceOwnPassword(
        c.var.user,
        c.req.valid("json"),
        credential.kind === "session" ? credential.sessionId : undefined,
      );
      return c.body(null, 204);
    },
  )
  .get("/me/tokens", requireAuth(), async (c) => {
    const rows = await c.var.services.users.listTokens(c.var.user);
    return c.json(rows.map((row) => TokenSchema.parse(row)));
  })
  .post("/me/tokens", requireAuth(), validate("json", TokenMintSchema, "name is required."), async (c) => {
    const { token, secret } = await c.var.services.users.mintToken(c.var.user, c.req.valid("json").name);
    return c.json(TokenCreatedSchema.parse({ ...token, secret }), 201);
  })
  .delete("/me/tokens/:token_id", requireAuth(), uuidParam("token_id", () => new TokenNotFoundError()), async (c) => {
    await c.var.services.users.deleteToken(c.var.user, c.req.valid("param").token_id);
    return c.body(null, 204);
  })
  .patch(
    "/:user_id",
    requireAuth(),
    requireRole("admin"),
    uuidParam("user_id", () => new UserNotFoundError()),
    validate("json", UserRoleUpdateSchema, "role is required."),
    async (c) => {
      const updated = await c.var.services.users.updateRole(c.var.user, c.req.valid("param").user_id, c.req.valid("json").role);
      return c.json(UserSchema.parse(updated));
    },
  )
  .delete("/:user_id", requireAuth(), requireRole("admin"), uuidParam("user_id", () => new UserNotFoundError()), async (c) => {
    await c.var.services.users.remove(c.var.user, c.req.valid("param").user_id);
    return c.body(null, 204);
  });
