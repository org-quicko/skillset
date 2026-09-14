import { describe, expect, it } from "bun:test";
import { symmetricEncrypt } from "better-auth/crypto";
import { deriveKeys, openClientSecret, openSecret, sealSecret } from "./secrets.js";

const SECRET = "test-only-secret-with-enough-entropy-to-be-quiet";

/**
 * Seam 0 — the key derivation and the two read paths, with nothing stored
 * anywhere. What matters here is that a value written for one purpose cannot
 * be read as another, and that rows written before ISSUE-9 still open.
 */
describe("per-purpose keys (ISSUE-9)", () => {
  it("derives a different key per purpose from the same secret", () => {
    const keys = deriveKeys(SECRET);
    const clientSecrets = keys.clientSecrets.keys.get(keys.clientSecrets.currentVersion);
    const connectionTokens = keys.connectionTokens.keys.get(keys.connectionTokens.currentVersion);

    expect(clientSecrets).toBeTruthy();
    expect(connectionTokens).toBeTruthy();
    expect(clientSecrets).not.toBe(connectionTokens);
    expect(clientSecrets).not.toBe(keys.connectionState);
    // None of them is the signing secret itself, which Better Auth still uses
    // for its own cookie signatures.
    expect(clientSecrets).not.toBe(SECRET);
  });

  it("derives the same keys every time, or nothing already stored would open", () => {
    const first = deriveKeys(SECRET);
    const second = deriveKeys(SECRET);
    expect(first.clientSecrets.keys.get(1)).toBe(second.clientSecrets.keys.get(1));
    expect(first.connectionState).toBe(second.connectionState);
  });

  it("derives different keys from different secrets", () => {
    expect(deriveKeys(SECRET).connectionState).not.toBe(deriveKeys(`${SECRET}-other`).connectionState);
  });

  it("round-trips a value under the purpose it was sealed for", async () => {
    const keys = deriveKeys(SECRET);
    const sealed = await sealSecret(keys.clientSecrets, "s3cr3t");

    expect(sealed).not.toContain("s3cr3t");
    expect(await openSecret(keys.clientSecrets, sealed)).toBe("s3cr3t");
  });

  it("refuses to open a value sealed for a different purpose", async () => {
    const keys = deriveKeys(SECRET);
    const sealed = await sealSecret(keys.clientSecrets, "s3cr3t");

    // The point of domain separation: ciphertext from one context is not
    // plaintext in another.
    await expect(openSecret(keys.connectionTokens, sealed)).rejects.toThrow();
  });
});

describe("reading secrets stored before they were encrypted (ISSUE-9)", () => {
  it("passes a plaintext client secret through, so an upgraded instance keeps working", async () => {
    // What `identity_providers.client_secret` and `integrations.client_secret`
    // hold on an instance that upgraded into the encrypted column: the
    // credential as an Admin typed it. No migration can re-encrypt those —
    // SQL has no key — so the read path tolerates them.
    expect(await openClientSecret(deriveKeys(SECRET).clientSecrets, "plain-client-secret")).toBe(
      "plain-client-secret",
    );
  });

  it("decrypts a client secret this app wrote, rather than returning the ciphertext", async () => {
    const keys = deriveKeys(SECRET);
    const sealed = await sealSecret(keys.clientSecrets, "s3cr3t");
    expect(await openClientSecret(keys.clientSecrets, sealed)).toBe("s3cr3t");
  });

  it("decrypts a Connection token written under the bare signing secret", async () => {
    // The old scheme: `symmetricEncrypt` with the secret itself, no envelope.
    const legacy = await symmetricEncrypt({ key: SECRET, data: "ghu_stored_access" });
    expect(await openSecret(deriveKeys(SECRET).connectionTokens, legacy)).toBe("ghu_stored_access");
  });
});
