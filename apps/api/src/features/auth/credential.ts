import type { Database } from "../../db/client.js";

/**
 * The `provider_id` Better Auth stores a password under. Not a Provider kind
 * (ADR-0017) — this is the row that says "this User has a password", and it
 * sits in the same table as the external accounts on purpose.
 */
export const CREDENTIAL_PROVIDER_ID = "credential";

/**
 * Writes a User's password, replacing any they already had.
 *
 * @remarks
 * The hash lives in `accounts`, not on the `users` row (ADR-0016), so this is
 * the only place that knows where. Still argon2id, still never plaintext —
 * only the column moved.
 *
 * Accepts a transaction so that creating a User and giving them a password is
 * one atomic act: a `users` row with no credential would be a User nobody can
 * log in as and no route can repair.
 *
 * @param db - The database or transaction to write through (a Kysely
 * `Transaction` is a `Database`).
 * @param userId - The User the password belongs to.
 * @param passwordHash - The argon2id hash, from `hashPassword`.
 * @example
 * ```ts
 * await setPasswordCredential(tx, created.id, await hashPassword(initial));
 * ```
 */
export async function setPasswordCredential(
  db: Database,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await db
    .insertInto("accounts")
    .values({
      user_id: userId,
      account_id: userId,
      provider_id: CREDENTIAL_PROVIDER_ID,
      password: passwordHash,
    })
    .onConflict((oc) =>
      oc.columns(["provider_id", "account_id"]).doUpdateSet({ password: passwordHash, updated_at: new Date() }),
    )
    .execute();
}

/**
 * Reads a User's stored password hash.
 *
 * @remarks
 * Returns `null` for a User who has no password at all rather than throwing —
 * one who arrived through an Identity Provider never had one (ADR-0007), and
 * every caller has to tolerate that.
 *
 * @param db - The database to read from.
 * @param userId - The User whose password to look up.
 * @returns The argon2id hash, or `null` if they have no password.
 * @example
 * ```ts
 * const matches = await verifyPassword(given, await getPasswordCredential(db, user.id));
 * ```
 */
export async function getPasswordCredential(db: Database, userId: string): Promise<string | null> {
  const account = await db
    .selectFrom("accounts")
    .select("password")
    .where("user_id", "=", userId)
    .where("provider_id", "=", CREDENTIAL_PROVIDER_ID)
    .executeTakeFirst();
  return account?.password ?? null;
}
