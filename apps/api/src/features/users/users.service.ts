import {
  USER_PAGE_SIZE,
  type AssignableRole,
  type Page,
  type PasswordReplace,
  type UserCreate,
  type UserUpdateName,
} from "@in-org-quicko/sqillset-shared";
import { and, count, desc, eq, ne } from "drizzle-orm";
import { getPasswordCredential, setPasswordCredential } from "../auth/credential.js";
import { generateInitialPassword, hashPassword, verifyPassword } from "../auth/password.js";
import { generateTokenSecret, hashTokenSecret } from "../auth/token.js";
import type { Database } from "../../db/client.js";
import { firstRow } from "../../db/rows.js";
import { isUniqueViolation } from "../../db/pg-errors.js";
import { sessions, tokens, users, type TokenRow, type UserRow } from "../../db/schemas/index.js";
import { EmailTakenError, SuperadminProtectedError, TokenNotFoundError, UserNotFoundError } from "./users.errors.js";
import { ValidationError } from "../../lib/errors.js";
import type { Logger } from "../../lib/logger.js";

/** A page below 1 — or not a number at all — is the first page, not an error. */
function parsePage(raw: string | undefined): number {
  const page = Number(raw ?? "1");
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** Users and the Tokens they own: Admin management, and each User's own profile and credentials. */
export class UsersService {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  /**
   * Lists Users, most recently created first, one page at a time.
   *
   * @param rawPage - The requested page number, as a string straight from a
   * query parameter. Anything below 1, or not a number at all, is treated as
   * the first page.
   * @returns The matching page of Users, alongside the page number, page
   * size, and total count.
   * @example
   * ```ts
   * const { items, total } = await usersService.list("1");
   * ```
   */
  async list(rawPage: string | undefined): Promise<Page<UserRow>> {
    const page = parsePage(rawPage);

    const rows = await this.db
      .select()
      .from(users)
      .orderBy(desc(users.created_at))
      .limit(USER_PAGE_SIZE)
      .offset((page - 1) * USER_PAGE_SIZE);

    const [totals] = await this.db.select({ total: count() }).from(users);

    return {
      items: rows,
      page,
      page_size: USER_PAGE_SIZE,
      total: totals?.total ?? 0,
    };
  }

  /**
   * Creates a User with a generated initial password.
   *
   * @remarks
   * The plaintext initial password is returned only here — it is never
   * stored, and never appears in `list` above.
   *
   * @param actor - The Admin or Superadmin creating the User.
   * @param input - The new User's names, email, and role. `role` excludes
   * `superadmin`, which only `/setup` ever grants.
   * @returns `{ user: UserRow; initial_password: string }`
   * @throws EmailTakenError if a User with that email already exists.
   * @example
   * ```ts
   * const { user, initial_password } = await usersService.create(actor, {
   *   first_name: "Ada",
   *   last_name: "Lovelace",
   *   email: "ada@example.com",
   *   role: "writer",
   * });
   * ```
   */
  async create(actor: UserRow, input: UserCreate): Promise<{ user: UserRow; initial_password: string }> {
    const initial_password = generateInitialPassword();
    const password_hash = await hashPassword(initial_password);

    let created: UserRow;
    try {
      // The row and its credential are written together: a User with no
      // password could not log in, and no route creates one afterwards.
      created = await this.db.transaction(async (tx) => {
        const inserted = await tx
          .insert(users)
          .values({
            first_name: input.first_name,
            last_name: input.last_name,
            email: input.email,
            // Not "we challenged this address" — the Registry sends no email.
            // It records that an Admin named the address, which is this
            // system's assertion that it is theirs (CONTEXT.md). Required, not
            // tidy: Better Auth refuses to link a Provider login to an
            // unverified row, and ADR-0015 requires that link to work.
            email_verified: true,
            role: input.role,
            must_change_password: true,
          })
          .returning();
        const row = firstRow(inserted, "User insert");

        await setPasswordCredential(tx, row.id, password_hash);
        return row;
      });
    } catch (cause) {
      if (isUniqueViolation(cause)) throw new EmailTakenError();
      throw cause;
    }

    this.logger.info({ actor_id: actor.id, user_id: created.id, role: created.role }, "user created");
    return { user: created, initial_password };
  }

  /**
   * Corrects a User's own first and/or last name.
   *
   * @param user - The User correcting their own name.
   * @param input - The names to replace; at least one is present.
   * @returns The updated `UserRow`.
   * @example
   * ```ts
   * const updated = await usersService.updateOwnName(user, { last_name: "Lovelace-Byron" });
   * ```
   */
  async updateOwnName(user: UserRow, input: UserUpdateName): Promise<UserRow> {
    const rows = await this.db
      .update(users)
      .set({ ...input, updated_at: new Date() })
      .where(eq(users.id, user.id))
      .returning();
    return firstRow(rows, "User name update");
  }

  /**
   * Replaces a User's own password, verifying the current one first.
   *
   * @remarks
   * Clears `must_change_password` — this is the route that resolves it
   * (docs/data-model.md).
   *
   * Every *other* session of this User is deleted in the same transaction
   * (ISSUE-10). Someone changing their password because they believe it is
   * compromised is asking for the access that password bought to end, and a
   * session lasts a week (`SESSION_TTL_SECONDS`), so leaving the others
   * standing meant the change bought them nothing. The session making the
   * request survives, so a routine change does not sign the person out of the
   * page they are on.
   *
   * Tokens are deliberately left alone: they are a separate credential that
   * the password never minted, and Settings lists them for revoking one by
   * one.
   *
   * @param user - The User replacing their own password.
   * @param input - The current password (verified) and the new one.
   * @param keepSessionId - The session making this request, the one session
   * not revoked. Omit to revoke every session, which is what a request made
   * with anything other than a session should do.
   * @returns How many other sessions were revoked.
   * @throws ValidationError with field `current_password` if it does not
   * match.
   * @example
   * ```ts
   * await usersService.replaceOwnPassword(
   *   user,
   *   { current_password: "the-generated-one", new_password: "a-new-password-of-my-own" },
   *   sessionId,
   * );
   * ```
   */
  async replaceOwnPassword(user: UserRow, input: PasswordReplace, keepSessionId?: string): Promise<number> {
    const current = await getPasswordCredential(this.db, user.id);
    const matches = await verifyPassword(input.current_password, current);
    if (!matches) {
      throw new ValidationError("current_password is incorrect.", "current_password");
    }

    const password_hash = await hashPassword(input.new_password);
    const revoked = await this.db.transaction(async (tx) => {
      await setPasswordCredential(tx, user.id, password_hash);
      // `must_change_password` is a column on the User, not the credential.
      await tx
        .update(users)
        .set({ must_change_password: false, updated_at: new Date() })
        .where(eq(users.id, user.id));

      // Better Auth owns this table (db/schemas/README.md), and this is the
      // one place anything else writes to it: there is no API for "revoke
      // every session but this one".
      const deleted = await tx
        .delete(sessions)
        .where(
          keepSessionId
            ? and(eq(sessions.user_id, user.id), ne(sessions.id, keepSessionId))
            : eq(sessions.user_id, user.id),
        )
        .returning({ id: sessions.id });
      return deleted.length;
    });

    this.logger.info({ user_id: user.id, sessions_revoked: revoked }, "password replaced");
    return revoked;
  }

  /**
   * Changes another User's role.
   *
   * @remarks
   * Takes effect on that User's next request — the role is re-read from the
   * database on every request, never cached in a session or Token (ADR-0005).
   *
   * @param actor - The Admin making the change.
   * @param userId - The target User's id.
   * @param role - The role to assign. Excludes `superadmin`.
   * @returns The updated `UserRow`.
   * @throws ValidationError if `userId` is the actor's own id — self-demotion
   * here can lock the last Admin out of every admin route.
   * @throws UserNotFoundError if no User exists by that id.
   * @throws SuperadminProtectedError if the target is the Superadmin.
   * @example
   * ```ts
   * const updated = await usersService.updateRole(actor, userId, "admin");
   * ```
   */
  async updateRole(actor: UserRow, userId: string, role: AssignableRole): Promise<UserRow> {
    if (userId === actor.id) {
      throw new ValidationError("You cannot change your own role here — use your profile instead.");
    }

    const target = await this.getOrThrow(userId);
    if (target.role === "superadmin") throw new SuperadminProtectedError();

    const rows = await this.db
      .update(users)
      .set({ role, updated_at: new Date() })
      .where(eq(users.id, userId))
      .returning();
    const updated = firstRow(rows, "User role update");

    this.logger.info({ actor_id: actor.id, user_id: userId, role }, "user role changed");
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
   * @param actor - The Admin removing the User.
   * @param userId - The target User's id.
   * @throws ValidationError if `userId` is the actor's own id — this flow has
   * no confirmation step, so self-removal is not offered through it.
   * @throws UserNotFoundError if no User exists by that id.
   * @throws SuperadminProtectedError if the target is the Superadmin.
   * @example
   * ```ts
   * await usersService.remove(actor, userId);
   * ```
   */
  async remove(actor: UserRow, userId: string): Promise<void> {
    if (userId === actor.id) {
      throw new ValidationError("You cannot remove your own account.");
    }

    const target = await this.getOrThrow(userId);
    if (target.role === "superadmin") throw new SuperadminProtectedError();

    await this.db.delete(users).where(eq(users.id, userId));
    this.logger.info({ actor_id: actor.id, user_id: userId }, "user removed");
  }

  /** Lists a User's own Tokens, newest first. */
  async listTokens(owner: UserRow): Promise<TokenRow[]> {
    return this.db.select().from(tokens).where(eq(tokens.user_id, owner.id)).orderBy(desc(tokens.created_at));
  }

  /**
   * Mints a new Token for a User.
   *
   * @remarks
   * The plaintext secret is returned only here — it is never stored, and
   * never appears in `listTokens` above.
   *
   * @param owner - The User the Token belongs to.
   * @param name - A caller-supplied label for the Token.
   * @returns `{ token: TokenRow; secret: string }`
   */
  async mintToken(owner: UserRow, name: string): Promise<{ token: TokenRow; secret: string }> {
    const secret = generateTokenSecret();
    const inserted = await this.db
      .insert(tokens)
      .values({ user_id: owner.id, name, token_hash: hashTokenSecret(secret) })
      .returning();
    const created = firstRow(inserted, "Token insert");

    this.logger.info({ user_id: owner.id, token_id: created.id }, "token minted");
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
   * @param owner - The User the Token must belong to.
   * @param tokenId - The Token's id.
   * @throws TokenNotFoundError if no Token by that id belongs to `owner`.
   * @example
   * ```ts
   * await usersService.deleteToken(user, tokenId);
   * ```
   */
  async deleteToken(owner: UserRow, tokenId: string): Promise<void> {
    const deleted = await this.db
      .delete(tokens)
      .where(and(eq(tokens.id, tokenId), eq(tokens.user_id, owner.id)))
      .returning({ id: tokens.id });

    if (deleted.length === 0) {
      throw new TokenNotFoundError();
    }
    this.logger.info({ user_id: owner.id, token_id: tokenId }, "token deleted");
  }

  private async getOrThrow(userId: string): Promise<UserRow> {
    const [row] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!row) throw new UserNotFoundError();
    return row;
  }
}
