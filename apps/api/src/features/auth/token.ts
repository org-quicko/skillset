import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const SECRET_BYTES = 32; // 256 bits — the ticket's entropy floor.

/** A cryptographically secure, 256-bit secret, base64url-encoded for the wire. */
export function generateTokenSecret(): string {
  return randomBytes(SECRET_BYTES).toString("base64url");
}

/**
 * Only this digest is stored (docs/data-model.md) — never the secret. SHA-256
 * rather than argon2id: the secret is already high-entropy, so a KDF buys no
 * brute-force resistance and would add latency to every CLI request.
 */
export function hashTokenSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * A short-circuiting `===` on a credential digest is a timing oracle — this
 * compares in constant time instead. Both arguments are SHA-256 hex digests,
 * always 64 characters, so a length mismatch (and thus `timingSafeEqual`
 * throwing) never happens in practice; the check below is a guard, not an
 * expected path.
 */
export function digestsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
