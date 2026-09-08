import { count, sql } from "drizzle-orm";
import type { SetupInit } from "@skillset/shared";
import { setPasswordCredential } from "../auth/credential.js";
import { hashPassword } from "../auth/password.js";
import { advisoryLockKey } from "../db/advisory-lock.js";
import type { Database } from "../db/client.js";
import { firstRow } from "../db/rows.js";
import { users, type UserRow } from "../db/schemas/index.js";
import { AlreadyInitializedError } from "../http/errors.js";
import type { Logger } from "../logger.js";

// Serialises against concurrent initialisation attempts — see setup.test.ts.
// Transaction-scoped (pg_advisory_xact_lock) rather than session-scoped:
// postgres.js pools connections per statement, so a session-level
// lock/unlock pair isn't guaranteed to run on the same backend session.
const INIT_LOCK_KEY = advisoryLockKey("skillset:setup-init");

/** First-run initialisation: whether the instance has a superadmin, and creating one. */
export class SetupService {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  /**
   * Whether the instance already has its first User.
   *
   * @returns `{ initialized: boolean }`
   */
  async getState(): Promise<{ initialized: boolean }> {
    const [row] = await this.db.select({ count: count() }).from(users);
    return { initialized: (row?.count ?? 0) > 0 };
  }

  /**
   * Creates the instance's first User as a superadmin.
   *
   * @remarks
   * Serialised by a transaction-scoped advisory lock, so two simultaneous
   * setup requests cannot both succeed.
   *
   * No session is issued here. Better Auth owns sessions (ADR-0016), so the
   * route signs the new superadmin in through its public endpoint — the first
   * login then takes the same path as every one after it.
   *
   * @param input - The first superadmin's name, email, and password.
   * @returns The created superadmin's row.
   * @throws AlreadyInitializedError if a User already exists.
   */
  async initializeSuperadmin(input: SetupInit): Promise<UserRow> {
    const passwordHash = await hashPassword(input.password);

    const superadmin: UserRow | null = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${INIT_LOCK_KEY})`);

      const [row] = await tx.select({ count: count() }).from(users);
      if ((row?.count ?? 0) > 0) {
        return null;
      }

      const inserted = await tx
        .insert(users)
        .values({
          first_name: input.first_name,
          last_name: input.last_name,
          email: input.email,
          // See `UsersService.create` for why a Registry-created User is
          // verified. Without it the Superadmin could never sign in through a
          // Provider, which is the one account most likely to try (ADR-0015).
          email_verified: true,
          role: "superadmin",
        })
        .returning();
      const created = firstRow(inserted, "Superadmin insert");

      // Inside the transaction: a superadmin with no credential is an instance
      // nobody can log into and no route can repair.
      await setPasswordCredential(tx, created.id, passwordHash);
      return created;
    });

    if (!superadmin) {
      throw new AlreadyInitializedError();
    }

    this.logger.info({ user_id: superadmin.id }, "instance initialized with first superadmin");
    return superadmin;
  }
}
