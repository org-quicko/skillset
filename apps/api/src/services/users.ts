import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { generateTokenSecret, hashTokenSecret } from "../auth/token.js";
import type { Database } from "../db/client.js";
import { tokens, type TokenRow, type UserRow } from "../db/schema.js";
import { TokenNotFoundError } from "../http/errors.js";
import type { Logger } from "../logger.js";

export interface UsersServiceDependencies {
  db: Database;
  logger: Logger;
}

/**
 * Lists a User's own Tokens, newest first.
 *
 * @param deps - The database this reads from.
 * @param owner - The User whose Tokens to list.
 * @returns `TokenRow[]`
 */
export async function listTokens(deps: UsersServiceDependencies, owner: UserRow): Promise<TokenRow[]> {
  return deps.db.select().from(tokens).where(eq(tokens.user_id, owner.id)).orderBy(desc(tokens.created_at));
}

/**
 * Mints a new Token for a User.
 *
 * @remarks
 * The plaintext secret is returned only here — it is never stored, and
 * never appears in `listTokens` above.
 *
 * @param deps - The database and logger this needs.
 * @param owner - The User the Token belongs to.
 * @param name - A caller-supplied label for the Token.
 * @returns `{ token: TokenRow; secret: string }`
 */
export async function mintToken(
  deps: UsersServiceDependencies,
  owner: UserRow,
  name: string,
): Promise<{ token: TokenRow; secret: string }> {
  const secret = generateTokenSecret();
  const [created] = await deps.db
    .insert(tokens)
    .values({ user_id: owner.id, name, token_hash: hashTokenSecret(secret) })
    .returning();
  if (!created) throw new Error("Insert did not return the created Token.");

  deps.logger.info({ user_id: owner.id, token_id: created.id }, "token minted");
  // The secret exists only in this return value — it is never stored, and
  // never appears in listTokens above.
  return { token: created, secret };
}

/**
 * Deletes one of a User's own Tokens.
 *
 * @remarks
 * A Token id belonging to someone else, or that doesn't exist at all, is
 * reported identically to an owned Token that's already gone — the caller
 * cannot distinguish "not yours" from "not found" either way.
 *
 * @param deps - The database and logger this needs.
 * @param owner - The User the Token must belong to.
 * @param tokenId - The Token's id.
 * @throws TokenNotFoundError if no Token by that id belongs to `owner`.
 */
export async function deleteToken(deps: UsersServiceDependencies, owner: UserRow, tokenId: string): Promise<void> {
  // A malformed id can never belong to the owner — treat it the same as
  // "not found" rather than letting an invalid UUID reach Postgres as a raw
  // query error.
  if (!z.uuid().safeParse(tokenId).success) {
    throw new TokenNotFoundError();
  }

  const deleted = await deps.db
    .delete(tokens)
    .where(and(eq(tokens.id, tokenId), eq(tokens.user_id, owner.id)))
    .returning({ id: tokens.id });

  if (deleted.length === 0) {
    throw new TokenNotFoundError();
  }
  deps.logger.info({ user_id: owner.id, token_id: tokenId }, "token deleted");
}
