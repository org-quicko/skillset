import { count, sql } from "drizzle-orm";
import { hashPassword } from "../auth/password.js";
import { signSession } from "../auth/session.js";
import { advisoryLockKey } from "../db/advisory-lock.js";
import type { Database } from "../db/client.js";
import { users, type UserRow } from "../db/schema.js";
import { AlreadyInitializedError } from "../http/errors.js";
import type { Logger } from "../logger.js";

export interface SetupServiceDependencies {
  db: Database;
  jwtSecret: string;
  logger: Logger;
}

// Serialises against concurrent initialisation attempts — see setup.test.ts.
// Transaction-scoped (pg_advisory_xact_lock) rather than session-scoped:
// postgres.js pools connections per statement, so a session-level
// lock/unlock pair isn't guaranteed to run on the same backend session.
const INIT_LOCK_KEY = advisoryLockKey("skill-registry:setup-init");

/**
 * Whether the instance already has its first User.
 *
 * @param deps - The database this reads from.
 * @returns `{ initialized: boolean }`
 */
export async function getSetupState(deps: SetupServiceDependencies): Promise<{ initialized: boolean }> {
  const [row] = await deps.db.select({ count: count() }).from(users);
  return { initialized: (row?.count ?? 0) > 0 };
}

/**
 * Creates the instance's first User as a superadmin, and issues a session
 * for them.
 *
 * @remarks
 * Serialised against concurrent initialisation attempts with a
 * transaction-scoped Postgres advisory lock, so two simultaneous setup
 * requests can't both succeed.
 *
 * @param deps - The database, JWT secret, and logger this needs.
 * @param input - The first superadmin's name, email, and password.
 * @returns `{ user: UserRow; token: string }`
 * @throws AlreadyInitializedError if a User already exists.
 */
export async function initializeSuperadmin(
  deps: SetupServiceDependencies,
  input: { first_name: string; last_name: string; email: string; password: string },
): Promise<{ user: UserRow; token: string }> {
  const passwordHash = await hashPassword(input.password);

  const superadmin: UserRow | null = await deps.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${INIT_LOCK_KEY})`);

    const [row] = await tx.select({ count: count() }).from(users);
    if ((row?.count ?? 0) > 0) {
      return null;
    }

    const [created] = await tx
      .insert(users)
      .values({
        first_name: input.first_name,
        last_name: input.last_name,
        email: input.email,
        password_hash: passwordHash,
        role: "superadmin",
      })
      .returning();
    if (!created) throw new Error("Insert did not return the created User.");
    return created;
  });

  if (!superadmin) {
    throw new AlreadyInitializedError();
  }

  const token = await signSession(superadmin.id, deps.jwtSecret);
  deps.logger.info({ user_id: superadmin.id }, "instance initialized with first superadmin");
  return { user: superadmin, token };
}
