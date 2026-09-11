import { randomBytes } from "node:crypto";

const ARGON2ID = { algorithm: "argon2id" as const };

// 12 random bytes, base64url-encoded, is 16 characters — comfortably over the
// 12-character floor PasswordReplaceSchema enforces when a User replaces it.
const INITIAL_PASSWORD_BYTES = 12;

/** Hashes with the runtime's built-in argon2id. Plaintext is never persisted. */
export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, ARGON2ID);
}

/**
 * Generates an initial password for an Admin-created User.
 *
 * @remarks
 * Shown once in the `POST /users` response and never stored in plaintext
 * (docs/data-model.md) — only `hashPassword`'s output of it is persisted.
 *
 * @returns A base64url-encoded random string, safely over the 12-character
 * floor `PasswordReplaceSchema` enforces when a User later replaces it.
 * @example
 * ```ts
 * const initial_password = generateInitialPassword();
 * const password_hash = await hashPassword(initial_password);
 * ```
 */
export function generateInitialPassword(): string {
  return randomBytes(INITIAL_PASSWORD_BYTES).toString("base64url");
}

/**
 * A User may have no password at all (ADR-0007) — callers pass `hash` as
 * `null` in that case rather than assuming every User can authenticate this
 * way, and this always resolves to `false` rather than throwing.
 */
export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  if (hash === null) return false;
  return Bun.password.verify(password, hash);
}
