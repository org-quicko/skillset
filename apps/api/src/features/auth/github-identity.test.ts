import { afterEach, describe, expect, it } from "bun:test";
import { fetchGitHubIdentity } from "./github.js";

const realFetch = globalThis.fetch;

interface GitHubStub {
  user?: Record<string, unknown>;
  emails?: Record<string, unknown>[];
  orgs?: Record<string, unknown>[];
}

/** Answers the three calls `fetchGitHubIdentity` makes, so the mapping can be tested without GitHub. */
function stubGitHub(stub: GitHubStub): void {
  const user = { id: 1, login: "dev", name: "Dev", avatar_url: null, email: null, ...stub.user };
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const path = new URL(String(input)).pathname;
    const body =
      path === "/user" ? user : path === "/user/emails" ? (stub.emails ?? []) : (stub.orgs ?? [{ login: "acme" }]);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

/**
 * Seam — what a GitHub login asserts about its own address.
 *
 * Not a gate on who gets an account (ADR-0018 leaves that to organisation
 * membership), but it does decide whether the login may attach to a User that
 * already exists. This was once hard-coded `true`, which meant anyone able to
 * set an unverified primary address to an existing User's could sign in as them.
 */
describe("fetchGitHubIdentity reports whether GitHub verified the address", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("reports a verified primary address as verified", async () => {
    stubGitHub({ emails: [{ email: "dev@example.com", primary: true, verified: true }] });
    const identity = await fetchGitHubIdentity("token");
    expect(identity.email).toBe("dev@example.com");
    expect(identity.email_verified).toBe(true);
  });

  it("reports an unverified primary address as unverified", async () => {
    stubGitHub({ emails: [{ email: "victim@example.com", primary: true, verified: false }] });
    const identity = await fetchGitHubIdentity("token");
    expect(identity.email).toBe("victim@example.com");
    expect(identity.email_verified).toBe(false);
  });

  it("does not call the public profile address verified — GitHub said nothing about it", async () => {
    // No primary address at all, so the address falls back to /user's public
    // one. There is no flag to read for it, and absent a flag it is not verified.
    stubGitHub({ user: { email: "public@example.com" }, emails: [] });
    const identity = await fetchGitHubIdentity("token");
    expect(identity.email).toBe("public@example.com");
    expect(identity.email_verified).toBe(false);
  });

  it("reports no address, and no verification, when GitHub gives neither", async () => {
    stubGitHub({ emails: [] });
    const identity = await fetchGitHubIdentity("token");
    expect(identity.email).toBeNull();
    expect(identity.email_verified).toBe(false);
  });

  it("lowercases the organisations the gate compares against", async () => {
    stubGitHub({ emails: [{ email: "dev@example.com", primary: true, verified: true }], orgs: [{ login: "ACME" }] });
    expect((await fetchGitHubIdentity("token")).organisations).toEqual(["acme"]);
  });
});
