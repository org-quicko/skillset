import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  SESSION_COOKIE_NAME,
  SIGN_IN_PATH,
  seedUserWithPassword,
  startTestContext,
  stopTestContext,
  type TestContext,
} from "../../../test/context.js";

interface ApiError {
  error: { code: string; field?: string };
}

const PASSWORD = "correct-horse-battery";

function sessionCookie(res: Response): string {
  const match = new RegExp(`${SESSION_COOKIE_NAME}=([^;]*)`).exec(
    res.headers.get("set-cookie") ?? "",
  );
  if (!match) throw new Error("Response did not set a session cookie.");
  return `${SESSION_COOKIE_NAME}=${match[1]}`;
}

describe("Marketplace settings (/marketplace/settings)", () => {
  let container: StartedPostgreSqlContainer;
  let context: TestContext;
  let admin: string;
  let writer: string;

  const put = (cookie: string, body: unknown) =>
    context.app.request("/api/marketplace/settings", {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    const started = await startTestContext();
    container = started.container;
    context = started.context;

    const signUp = await context.app.request("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        first_name: "Ada",
        last_name: "Lovelace",
        email: "ada@example.com",
        password: PASSWORD,
      }),
    });
    admin = sessionCookie(signUp);

    await seedUserWithPassword(context, {
      first_name: "Grace",
      last_name: "Hopper",
      email: "grace@example.com",
      password: PASSWORD,
      role: "writer",
    });
    const login = await context.app.request(SIGN_IN_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "grace@example.com", password: PASSWORD }),
    });
    writer = sessionCookie(login);
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  it("starts from the defaults, before an Admin saves anything", async () => {
    const res = await context.app.request("/api/marketplace/settings", {
      headers: { cookie: admin },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "skillset",
      owner_name: "Skillset",
      owner_email: null,
      description: null,
      updated_at: null,
    });

    const marketplace = (await (
      await context.app.request("/.claude-plugin/marketplace.json")
    ).json()) as Record<string, unknown>;
    expect(marketplace.name).toBe("skillset");
    expect(marketplace.owner).toEqual({ name: "Skillset" });
    expect(marketplace.metadata).toBeUndefined();
  });

  it("is Admin-only", async () => {
    expect((await context.app.request("/api/marketplace/settings")).status).toBe(401);
    expect(
      (await context.app.request("/api/marketplace/settings", { headers: { cookie: writer } }))
        .status,
    ).toBe(403);
    expect(
      (
        await put(writer, {
          name: "acme",
          owner_name: "Acme",
          owner_email: null,
          description: null,
        })
      ).status,
    ).toBe(403);
  });

  it("refuses a name Claude Code would not accept, and a malformed email", async () => {
    const badName = await put(admin, {
      name: "Acme Plugins",
      owner_name: "Acme",
      owner_email: null,
      description: null,
    });
    expect(badName.status).toBe(400);
    expect(((await badName.json()) as ApiError).error.field).toBe("name");

    const badEmail = await put(admin, {
      name: "acme",
      owner_name: "Acme",
      owner_email: "nope",
      description: null,
    });
    expect(badEmail.status).toBe(400);
    expect(((await badEmail.json()) as ApiError).error.field).toBe("owner_email");
  });

  it("saves the details, replaces them on a second save, and serves them in marketplace.json", async () => {
    const first = await put(admin, {
      name: "acme-plugins",
      owner_name: "Acme",
      owner_email: "plugins@acme.com",
      description: "Acme's plugins.",
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      name: "acme-plugins",
      owner_email: "plugins@acme.com",
    });

    const marketplace = (await (
      await context.app.request("/.claude-plugin/marketplace.json")
    ).json()) as Record<string, unknown>;
    expect(marketplace.name).toBe("acme-plugins");
    expect(marketplace.owner).toEqual({ name: "Acme", email: "plugins@acme.com" });
    expect(marketplace.metadata).toEqual({ description: "Acme's plugins." });

    const second = await put(admin, {
      name: "acme",
      owner_name: "Acme Inc",
      owner_email: null,
      description: null,
    });
    expect(second.status).toBe(200);
    const saved = (await (
      await context.app.request("/api/marketplace/settings", { headers: { cookie: admin } })
    ).json()) as Record<string, unknown>;
    expect(saved).toMatchObject({
      name: "acme",
      owner_name: "Acme Inc",
      owner_email: null,
      description: null,
    });
    expect(typeof saved.updated_at).toBe("string");
  });
});
