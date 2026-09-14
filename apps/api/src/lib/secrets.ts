import { hkdfSync } from "node:crypto";
import { symmetricDecrypt, symmetricEncrypt, type SecretConfig } from "better-auth/crypto";

/**
 * The prefix Better Auth's versioned-envelope ciphertext carries
 * (`$ba$<version>$<hex>`), and the only reliable way to tell a stored value
 * that is encrypted from one that is not.
 *
 * A bare ciphertext is plain hex, which a plaintext credential could also be,
 * so every secret this module writes goes through the envelope form — that is
 * what makes "is this row encrypted yet?" answerable at all.
 */
const ENVELOPE_PREFIX = "$ba$";

/** The version every value written now carries. A second entry appears here the day the secret is rotated. */
const CURRENT_KEY_VERSION = 1;

/**
 * The keys this app derives from `BETTER_AUTH_SECRET`, one per purpose.
 *
 * @remarks
 * `BETTER_AUTH_SECRET` used to be handed unchanged to three different
 * primitives: Better Auth's own signing, AES for Connection tokens, and HMAC
 * for the connect-flow state (ISSUE-9). Reusing one key across
 * unrelated primitives is what domain separation exists to prevent — a
 * weakness in any one of them reaches the others, and a value from one
 * context can be replayed into another. Each purpose now gets its own key
 * from HKDF, and the purpose string is the domain.
 *
 * Better Auth keeps the raw secret, because that is what its own cookie
 * signatures were produced with and changing it would invalidate every
 * session in existence.
 */
export interface DerivedKeys {
  /** `identity_providers.client_secret` and `integrations.client_secret`. */
  clientSecrets: SecretConfig;
  /** `connections.access_token` and `.refresh_token`. */
  connectionTokens: SecretConfig;
  /** The HMAC key the connect-flow state is signed with. */
  connectionState: string;
}

/** One HKDF-SHA256 key, hex, bound to `skillset:<purpose>`. */
function derive(secret: string, purpose: string): string {
  return Buffer.from(hkdfSync("sha256", secret, "", `skillset:${purpose}`, 32)).toString("hex");
}

/**
 * Derives every per-purpose key from the instance's signing secret.
 *
 * @remarks
 * `connectionTokens` carries `legacySecret` and `clientSecrets` does not, and
 * that asymmetry is the migration. A Connection token written before this
 * change is bare hex encrypted under the raw secret, which
 * `symmetricDecrypt` falls back to when it finds no envelope — so existing
 * grants keep working and are re-encrypted under the derived key the next
 * time they are written. A client secret written before this change is not
 * ciphertext at all but plaintext, so it needs `openClientSecret` below
 * rather than a fallback key.
 *
 * @param secret - `BETTER_AUTH_SECRET`.
 * @returns The keys, one per purpose.
 * @example
 * ```ts
 * const keys = deriveKeys(config.betterAuthSecret);
 * const stored = await sealSecret(keys.clientSecrets, "s3cr3t");
 * ```
 */
export function deriveKeys(secret: string): DerivedKeys {
  return {
    clientSecrets: {
      keys: new Map([[CURRENT_KEY_VERSION, derive(secret, "client-secrets")]]),
      currentVersion: CURRENT_KEY_VERSION,
    },
    connectionTokens: {
      keys: new Map([[CURRENT_KEY_VERSION, derive(secret, "connection-tokens")]]),
      currentVersion: CURRENT_KEY_VERSION,
      legacySecret: secret,
    },
    connectionState: derive(secret, "connection-state"),
  };
}

/** Encrypts a value for storage, in the versioned envelope form. */
export function sealSecret(key: SecretConfig, plaintext: string): Promise<string> {
  return symmetricEncrypt({ key, data: plaintext });
}

/** Decrypts a value this module wrote. */
export function openSecret(key: SecretConfig, stored: string): Promise<string> {
  return symmetricDecrypt({ key, data: stored });
}

/**
 * Decrypts a stored client secret, passing through one that was stored as
 * plaintext.
 *
 * @remarks
 * `identity_providers.client_secret` and `integrations.client_secret` were
 * stored as given (ADR-0015), so an instance upgrading into this change has
 * rows holding a live third-party credential in the clear. There is no
 * migration that could re-encrypt them — the SQL does not have the key — so
 * instead a row without the envelope prefix is read as the plaintext it is,
 * and is written back encrypted the next time an Admin saves that Provider or
 * Integration.
 *
 * @param key - The client-secret key from `deriveKeys`.
 * @param stored - The column's value.
 * @returns The plaintext secret.
 * @example
 * ```ts
 * const clientSecret = await openClientSecret(keys.clientSecrets, provider.client_secret);
 * ```
 */
export function openClientSecret(key: SecretConfig, stored: string): Promise<string> {
  if (!stored.startsWith(ENVELOPE_PREFIX)) return Promise.resolve(stored);
  return openSecret(key, stored);
}
