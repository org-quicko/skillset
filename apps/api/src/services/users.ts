import type { AssignableRole } from "@skill-registry/shared";
import { USER_PAGE_SIZE } from "@skill-registry/shared";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { generateInitialPassword, hashPassword, verifyPassword } from "../auth/password.js";
import { generateTokenSecret, hashTokenSecret } from "../auth/token.js";
import type { Database } from "../db/client.js";
import { tokens, users, type TokenRow, type UserRow } from "../db/schema.js";
import {
  EmailTakenError,
  SuperadminProtectedError,
  TokenNotFoundError,
  UserNotFoundError,
  ValidationError,
} from "../http/errors.js";
import type { Logger } from "../logger.js";

export interface UsersServiceDependencies {
  db: Database;
  logger: Logger;
}

/** A page below 1 — or not a number at all — is the first page, not an error. */
function parsePage(raw: string | undefined): number {
  const page = Number(raw ?? "1");
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** Postgres's unique_violation code — raised here only by `users.email`'s unique constraint. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

async function getUserOrThrow(deps: UsersServiceDependencies, userId: string): Promise<UserRow> {
  // A malformed id can never match a row — treat it the same as "not found"
  // rather than letting an invalid UUID reach Postgres as a raw query error.
  if (!z.uuid().safeParse(userId).success) {
    throw new UserNotFoundError();
  }

  const [row] = await deps.db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw new UserNotFoundError();
  return row;
}

/**
 * Lists Users, most recently created first, one page at a time.
 *
 * @param deps - The database this reads from.
 * @param rawPage - The requested page number, as a string straight from a
 * query parameter. Anything below 1, or not a number at all, is treated as
 * the first page.
 * @returns The matching page of Users, alongside the page number, page
 * size, and total count.
 * @example
 * ```ts
 * const { items, total } = await listUsers(deps, "1");
 * ```
 */
export async function listUsers(
  deps: UsersServiceDependencies,
  rawPage: string | undefined,
): Promise<{ items: UserRow[]; page: number; page_size: number; total: number }> {
  const page = parsePage(rawPage);

  const items = await deps.db
    .select()
    .from(users)
    .orderBy(desc(users.created_at))
    .limit(USER_PAGE_SIZE)
    .offset((page - 1) * USER_PAGE_SIZE);

  const [totals] = await deps.db.select({ total: count() }).from(users);

  return { items, page, page_size: USER_PAGE_SIZE, total: totals?.total ?? 0 };
}

/**
 * Creates a User with a generated initial password.
 *
 * @remarks
 * The plaintext initial password is returned only here — it is never
 * stored, and never appears in `listUsers` above.
 *
 * @param deps - The database and logger this needs.
 * @param input - The new User's names, email, and role. `role` excludes
 * `superadmin`, which only `/setup` ever grants.
 * @returns `{ user: UserRow; initial_password: string }`
 * @throws EmailTakenError if a User with that email already exists.
 * @example
 * ```ts
 * const { user, initial_password } = await createUser(deps, {
 *   first_name: "Ada",
 *   last_name: "Lovelace",
 *   email: "ada@example.com",
 *   role: "writer",
 * });
 * ```
 */
export async function createUser(
  deps: UsersServiceDependencies,
  input: { first_name: string; last_name: string; email: string; role: AssignableRole },
): Promise<{ user: UserRow; initial_password: string }> {
  const initial_password = generateInitialPassword();
  const password_hash = await hashPassword(initial_password);

  let created: UserRow | undefined;
  try {
    [created] = await deps.db
      .insert(users)
      .values({
        first_name: input.first_name,
        last_name: input.last_name,
        email: input.email,
        password_hash,
        role: input.role,
        must_change_password: true,
      })
      .returning();
  } catch (cause) {
    if (isUniqueViolation(cause)) throw new EmailTakenError();
    throw cause;
  }
  if (!created) throw new Error("Insert did not return the created User.");

  deps.logger.info({ user_id: created.id, role: created.role }, "user created");
  // The initial password exists only in this return value — it is never
  // stored, and never appears in listUsers above.
  return { user: created, initial_password };
}

/**
 * Corrects a User's own first and/or last name.
 *
 * @param deps - The database this needs.
 * @param user - The User correcting their own name.
 * @param input - The names to replace; at least one is present.
 * @returns The updated `UserRow`.
 * @example
 * ```ts
 * const updated = await updateOwnName(deps, user, { last_name: "Lovelace-Byron" });
 * ```
 */
export async function updateOwnName(
  deps: UsersServiceDependencies,
  user: UserRow,
  input: { first_name?: string; last_name?: string },
): Promise<UserRow> {
  const [updated] = await deps.db
    .update(users)
    .set({ ...input, updated_at: new Date() })
    .where(eq(users.id, user.id))
    .returning();
  if (!updated) throw new Error("Update did not return the User.");
  return updated;
}

/**
 * Replaces a User's own password, verifying the current one first.
 *
 * @remarks
 * Clears `must_change_password` — this is the route that resolves it
 * (docs/data-model.md).
 *
 * @param deps - The database this needs.
 * @param user - The User replacing their own password.
 * @param input - The current password (verified) and the new one.
 * @throws ValidationError with field `current_password` if it does not
 * match.
 * @example
 * ```ts
 * await replaceOwnPassword(deps, user, {
 *   current_password: "the-generated-one",
 *   new_password: "a-new-password-of-my-own",
 * });
 * ```
 */
export async function replaceOwnPassword(
  deps: UsersServiceDependencies,
  user: UserRow,
  input: { current_password: string; new_password: string },
): Promise<void> {
  const matches = await verifyPassword(input.current_password, user.password_hash);
  if (!matches) {
    throw new ValidationError("current_password is incorrect.", "current_password");
  }

  const password_hash = await hashPassword(input.new_password);
  await deps.db
    .update(users)
    .set({ password_hash, must_change_password: false, updated_at: new Date() })
    .where(eq(users.id, user.id));
  deps.logger.info({ user_id: user.id }, "password replaced");
}

/**
 * Changes another User's role.
 *
 * @remarks
 * Takes effect on that User's next request — the role is re-read from the
 * database on every request, never cached in a session or Token (ADR-0005).
 *
 * @param deps - The database and logger this needs.
 * @param actor - The Admin making the change.
 * @param userId - The target User's id.
 * @param role - The role to assign. Excludes `superadmin`.
 * @returns The updated `UserRow`.
 * @throws ValidationError if `userId` is the actor's own id — an Admin
 * changing their own role belongs on their own profile, and doing it here
 * would risk locking themselves out of every admin route with no other
 * Admin present to undo it.
 * @throws UserNotFoundError if no User exists by that id.
 * @throws SuperadminProtectedError if the target is the Superadmin.
 * @example
 * ```ts
 * const updated = await updateUserRole(deps, actor, userId, "admin");
 * ```
 */
export async function updateUserRole(
  deps: UsersServiceDependencies,
  actor: UserRow,
  userId: string,
  role: AssignableRole,
): Promise<UserRow> {
  if (userId === actor.id) {
    throw new ValidationError("You cannot change your own role here — use your profile instead.");
  }

  const target = await getUserOrThrow(deps, userId);
  if (target.role === "superadmin") throw new SuperadminProtectedError();

  const [updated] = await deps.db
    .update(users)
    .set({ role, updated_at: new Date() })
    .where(eq(users.id, userId))
    .returning();
  if (!updated) throw new Error("Update did not return the User.");

  deps.logger.info({ user_id: userId, role }, "user role changed");
  return updated;
}

/**
 * Removes a User, ending their access.
 *
 * @remarks
 * Their Tokens cascade-delete with them (docs/data-model.md). Skills they
 * published remain — `published_by` is set null, and the `published_by_email`
 * snapshot on each Skill still records who published it.
 *
 * @param deps - The database and logger this needs.
 * @param actor - The Admin removing the User.
 * @param userId - The target User's id.
 * @throws ValidationError if `userId` is the actor's own id — ending your
 * own access this way, with no confirmation beyond the ordinary remove
 * flow, is a mistake waiting to happen rather than a supported action.
 * @throws UserNotFoundError if no User exists by that id.
 * @throws SuperadminProtectedError if the target is the Superadmin.
 * @example
 * ```ts
 * await deleteUser(deps, actor, userId);
 * ```
 */
export async function deleteUser(deps: UsersServiceDependencies, actor: UserRow, userId: string): Promise<void> {
  if (userId === actor.id) {
    throw new ValidationError("You cannot remove your own account.");
  }

  const target = await getUserOrThrow(deps, userId);
  if (target.role === "superadmin") throw new SuperadminProtectedError();

  await deps.db.delete(users).where(eq(users.id, userId));
  deps.logger.info({ user_id: userId }, "user removed");
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
