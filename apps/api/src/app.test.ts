import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { AnalyticsService } from "./features/analytics/analytics.service.js";
import { createLogger } from "./lib/logger.js";
import { deriveKeys, openClientSecret } from "./lib/secrets.js";
import {
  seedUserWithPassword,
  signIn,
  startTestContext,
  stopTestContext,
  TEST_AUTH_SECRET,
  TEST_PUBLIC_URL,
  type TestContext,
} from "../test/context.js";

interface ApiError {
  error: { code: string; message: string; field?: string };
}

const PASSWORD = "correct-horse-battery";

/**
 * Seam 1 — the whole app, asked about the things that are true of *every*
 * response rather than of one route: the headers it carries, the bodies it
 * refuses, and the origins it accepts a mutation from.
 */
describe("responses every route shares (ISSUE-8)", () => {
  let container: StartedPostgreSqlContainer;
  let context: TestContext;

  beforeAll(async () => {
    const started = await startTestContext();
    container = started.container;
    context = started.context;
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  it("refuses to be framed, which is what a clickjacked admin control needs", async () => {
    const res = await context.app.request("/api/health");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("sends nothing but the origin as a Referer to a third party", async () => {
    const res = await context.app.request("/api/health");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("stops a browser guessing a content type it was given", async () => {
    const res = await context.app.request("/api/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("carries the headers on a refusal too, not only on a success", async () => {
    const res = await context.app.request("/api/resources/not-a-uuid");
    expect(res.status).toBe(404);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("does not claim HSTS over plain http, which a browser must ignore anyway", async () => {
    // `TEST_PUBLIC_URL` is http. On an https deployment this header is sent —
    // pinning localhost to https would break the next project served from it.
    expect(new URL(TEST_PUBLIC_URL).protocol).toBe("http:");
    const res = await context.app.request("/api/health");
    expect(res.headers.get("strict-transport-security")).toBeNull();
  });

  it("sets no app-wide CSP, which would overwrite the Artifact sandbox", async () => {
    // The one CSP here that is load-bearing is the one an Artifact file
    // response sets on a publisher's own bytes (ISSUE-1), and `secureHeaders`
    // applies its headers after the handler — so an app-wide policy would
    // replace it.
    const res = await context.app.request("/api/health");
    expect(res.headers.get("content-security-policy")).toBeNull();
  });

  it("gives every response a request id, so a report can be traced to its requests (ISSUE-19)", async () => {
    const res = await context.app.request("/api/health");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("serves the hand-written OpenAPI contract at the top level, not under /api", async () => {
    const res = await context.app.request("/openapi.json");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { openapi: string; info: { title: string } };
    expect(body.openapi).toBe("3.1.0");
    expect(body.info.title).toBe("Skillset API");
  });

  it("describes the stdio MCP server at /mcp rather than speaking MCP itself", async () => {
    const res = await context.app.request("/mcp");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transport: string; remote: boolean; tools: { name: string }[] };
    expect(body.transport).toBe("stdio");
    expect(body.remote).toBe(false);
    expect(body.tools.map((tool) => tool.name)).toContain("search_skills");
  });

  it("has nothing to serve at /mcp.mcpb until a build packs one (ADR-0037)", async () => {
    // No `mcpbPath` was given to this context, matching ordinary development
    // where nobody has run `apps/mcp`'s `package:mcpb` — the route must not
    // exist rather than error looking for a file that isn't there.
    const res = await context.app.request("/mcp.mcpb");
    expect(res.status).toBe(404);
  });
});

describe("the packed MCP bundle, when a build produced one (ADR-0037)", () => {
  let container: StartedPostgreSqlContainer;
  let context: TestContext;
  const mcpbPath = `${import.meta.dir}/../test/fixtures/fake.mcpb`;
  const mcpbBytes = new TextEncoder().encode("a fake .mcpb archive for testing the download route, not a real one");

  beforeAll(async () => {
    await Bun.write(mcpbPath, mcpbBytes);
    const started = await startTestContext({ mcpbPath });
    container = started.container;
    context = started.context;
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
    await Bun.file(mcpbPath).delete();
  });

  it("serves it as a download, byte for byte", async () => {
    const res = await context.app.request("/mcp.mcpb");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="skillset-mcp.mcpb"');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(mcpbBytes);
  });
});

describe("mutations and where they came from (ISSUE-17, ISSUE-20)", () => {
  let container: StartedPostgreSqlContainer;
  let context: TestContext;
  let cookie: string;

  beforeAll(async () => {
    const started = await startTestContext();
    container = started.container;
    context = started.context;

    await seedUserWithPassword(context, {
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      password: PASSWORD,
      role: "writer",
    });
    cookie = await signIn(context, "ada@example.com", PASSWORD);
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  it("refuses a form-shaped mutation from another origin, cookie and all", async () => {
    // The shape a cross-site form post takes: `text/plain` rather than JSON,
    // because a `<form>` cannot send an `application/json` body. The session
    // cookie rode along on `SameSite=Lax` alone until this check existed.
    const res = await context.app.request("/api/resources/skill/forged", {
      method: "PUT",
      headers: { cookie, origin: "https://attacker.example", "content-type": "text/plain" },
      body: JSON.stringify({ description: "Forged.", body: "Body.\n" }),
    });

    expect(res.status).toBe(403);
    const rows = await context.db.selectFrom("resources").selectAll().where("name", "=", "forged").execute();
    expect(rows.length).toBe(0);
  });

  it("accepts the same mutation from the Registry's own origin", async () => {
    const res = await context.app.request("/api/resources/skill/legitimate", {
      method: "PUT",
      headers: { cookie, origin: TEST_PUBLIC_URL, "content-type": "application/json" },
      body: JSON.stringify({
        description: "Published from the interface.",
        body: "Body.\n",
        files: [{ path: "SKILL.md", size: 6 }],
      }),
    });

    expect(res.status).toBe(200);
  });

  it("refuses a body larger than any legitimate request", async () => {
    // Bun would otherwise read up to 128 MB before validation ran, on a route
    // whose largest honest body is a manifest and a SKILL.md.
    const res = await context.app.request("/api/resources/skill/enormous", {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ description: "x".repeat(3 * 1024 * 1024), body: "Body.\n" }),
    });

    expect(res.status).toBe(413);
  });
});

describe("install counts and who can run them up (ISSUE-23)", () => {
  let container: StartedPostgreSqlContainer;
  let context: TestContext;
  let analytics: AnalyticsService;
  let id: string;

  beforeAll(async () => {
    const started = await startTestContext();
    container = started.container;
    context = started.context;
    analytics = new AnalyticsService(context.db, createLogger("silent"));

    await seedUserWithPassword(context, {
      first_name: "Grace",
      last_name: "Hopper",
      email: "grace@example.com",
      password: PASSWORD,
      role: "writer",
    });
    const cookie = await signIn(context, "grace@example.com", PASSWORD);

    const res = await context.app.request("/api/resources/skill/counted-skill", {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        description: "Counts installs.",
        body: "Body.\n",
        files: [{ path: "SKILL.md", size: 6 }],
      }),
    });
    id = ((await res.json()) as { skill: { id: string } }).skill.id;
    await context.storage.put(`resources/${id}/SKILL.md`, new TextEncoder().encode("Body.\n"));
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  async function eventCount(): Promise<number> {
    const rows = await context.db
      .selectFrom("resource_install_events")
      .selectAll()
      .where("resource_id", "=", id)
      .execute();
    return rows.length;
  }

  it("keeps one Install per client per day, however many times that client downloads", async () => {
    // The download endpoint is unauthenticated, so before this the count —
    // and the catalog's most-installed sort — was whatever anyone cared to
    // make it with a loop.
    const before = await eventCount();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await analytics.recordInstall(id, "web", "client-a");
    }

    expect(await eventCount()).toBe(before + 1);
  });

  it("counts a different client separately", async () => {
    const before = await eventCount();
    await analytics.recordInstall(id, "cli", "client-b");
    expect(await eventCount()).toBe(before + 1);
  });

  it("counts an Install it cannot identify, rather than dropping it", async () => {
    // Behind a proxy this app has not been told to trust there is no client
    // address to hash, and `app.request` has no socket at all. An uncounted
    // Install would be a worse answer than a double-counted one.
    const before = await eventCount();

    const first = await context.app.request(`/api/resources/${id}/artifact`);
    const second = await context.app.request(`/api/resources/${id}/artifact`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    expect(await eventCount()).toBe(before + 2);
  });
});

describe("who administers the Registry's logins (ISSUE-2)", () => {
  let container: StartedPostgreSqlContainer;
  let context: TestContext;

  beforeAll(async () => {
    const started = await startTestContext();
    container = started.container;
    context = started.context;

    await seedUserWithPassword(context, {
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      password: PASSWORD,
      role: "superadmin",
    });
    await seedUserWithPassword(context, {
      first_name: "Alan",
      last_name: "Turing",
      email: "alan@example.com",
      password: PASSWORD,
      role: "admin",
    });
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  const body = {
    kind: "google",
    display_name: "Google",
    client_id: "client-id",
    client_secret: "client-secret",
    permitted_organisations: ["example.com"],
    enabled: true,
  };

  it("refuses an Admin, for whom configuring a Provider is a way to outrank themselves", async () => {
    const cookie = await signIn(context, "alan@example.com", PASSWORD);

    const res = await context.app.request("/api/identity-providers", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as ApiError).error.code).toBe("forbidden");
  });

  it("refuses an Admin the list as well, which carries every Provider's configuration", async () => {
    const cookie = await signIn(context, "alan@example.com", PASSWORD);
    const res = await context.app.request("/api/identity-providers", { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it("allows the Superadmin, and stores the client secret encrypted (ISSUE-9)", async () => {
    const cookie = await signIn(context, "ada@example.com", PASSWORD);

    const res = await context.app.request("/api/identity-providers", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(201);
    // Never on the wire, encrypted or otherwise.
    expect(JSON.stringify(await res.json())).not.toContain("client-secret");

    // A database dump must not hand over the OAuth app's credentials either.
    const row = await context.db.selectFrom("identity_providers").selectAll().executeTakeFirst();
    expect(row?.client_secret).not.toBe("client-secret");
    expect(await openClientSecret(deriveKeys(TEST_AUTH_SECRET).clientSecrets, row?.client_secret ?? "")).toBe(
      "client-secret",
    );
  });
});
