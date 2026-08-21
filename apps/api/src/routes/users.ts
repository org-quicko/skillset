import { TokenCreatedSchema, TokenMintSchema, TokenSchema, UserSchema } from "@skill-registry/shared";
import { and, desc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { requireAuth, type AuthDependencies, type AuthVariables } from "../auth/middleware.js";
import { generateTokenSecret, hashTokenSecret } from "../auth/token.js";
import { tokens } from "../db/schema.js";
import { errorResponse } from "../http/errors.js";

export function registerUsersRoutes(app: Hono<{ Variables: AuthVariables }>, deps: AuthDependencies): void {
  app.get("/users/me", requireAuth(deps), async (c) => {
    // The role on this row was resolved fresh for this request by
    // requireAuth, not read from the session token (ADR-0005).
    return c.json(UserSchema.parse(c.get("user")));
  });

  // Nested under the owner because a User may only ever manage their own
  // Tokens (spec, "Shape") — every query below is scoped by the
  // authenticated User's id, never by a Token id alone.

  app.get("/users/me/tokens", requireAuth(deps), async (c) => {
    const owner = c.get("user");
    const rows = await deps.db
      .select()
      .from(tokens)
      .where(eq(tokens.user_id, owner.id))
      .orderBy(desc(tokens.created_at));
    return c.json(rows.map((row) => TokenSchema.parse(row)));
  });

  app.post("/users/me/tokens", requireAuth(deps), async (c) => {
    const parsed = TokenMintSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(c, 400, "validation_failed", "name is required.", "name");
    }

    const owner = c.get("user");
    const secret = generateTokenSecret();
    const [created] = await deps.db
      .insert(tokens)
      .values({ user_id: owner.id, name: parsed.data.name, token_hash: hashTokenSecret(secret) })
      .returning();
    if (!created) throw new Error("Insert did not return the created Token.");

    // The secret exists only in this response — it is never stored, and
    // never appears in the list above.
    return c.json(TokenCreatedSchema.parse({ ...created, secret }), 201);
  });

  app.delete("/users/me/tokens/:token_id", requireAuth(deps), async (c) => {
    const owner = c.get("user");
    const tokenId = c.req.param("token_id");
    // A malformed id can never belong to the owner — treat it the same as
    // "not found" rather than letting an invalid UUID reach Postgres as a
    // raw query error.
    if (!z.uuid().safeParse(tokenId).success) {
      return errorResponse(c, 404, "not_found", "No such Token belonging to you.");
    }

    const deleted = await deps.db
      .delete(tokens)
      .where(and(eq(tokens.id, tokenId), eq(tokens.user_id, owner.id)))
      .returning({ id: tokens.id });

    if (deleted.length === 0) {
      return errorResponse(c, 404, "not_found", "No such Token belonging to you.");
    }
    return c.body(null, 204);
  });
}
