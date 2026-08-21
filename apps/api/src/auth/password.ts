const ARGON2ID = { algorithm: "argon2id" as const };

/** Hashes with the runtime's built-in argon2id. Plaintext is never persisted. */
export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, ARGON2ID);
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
