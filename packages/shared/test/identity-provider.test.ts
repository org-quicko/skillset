import { describe, expect, it } from "bun:test";
import { loginRefusalMessage } from "../src/index.js";

/**
 * Seam — the one place a refused external login is explained to the person it
 * refused. A code with no entry here falls back to the generic sentence, so a
 * refusal added on the API side without a message reaches the login page saying
 * nothing useful and nothing fails to tell anyone.
 */
describe("loginRefusalMessage", () => {
  it("explains an unverified address, and says what to do about it", () => {
    const message = loginRefusalMessage("email_not_verified");
    expect(message).toContain("has not been verified");
    expect(message).not.toBe(loginRefusalMessage("external_login_failed"));
  });

  it("names no organisation, whichever refusal it explains", () => {
    // Which check failed is public; what would have passed it stays in the logs.
    for (const code of [
      "email_not_verified",
      "organisation_not_permitted",
      "oauth_app_not_approved",
      "no_email_from_provider",
      "provider_disabled",
      "provider_not_configured",
    ]) {
      expect(loginRefusalMessage(code)).not.toMatch(/example\.com|tenant/i);
    }
  });

  it("falls back to the generic sentence for a code it does not know", () => {
    expect(loginRefusalMessage("something_new")).toBe(loginRefusalMessage("external_login_failed"));
    expect(loginRefusalMessage(null)).toBe(loginRefusalMessage("external_login_failed"));
  });
});
