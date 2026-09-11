import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { onError } from "../lib/errors.js";
import { createLogger } from "../lib/logger.js";
import type { ClientIpEnv } from "./client-ip.js";
import { rateLimit } from "./rate-limit.js";

/**
 * Seam 0 — one middleware, against a bare Hono app. No database and no
 * container: what is under test is the counting, and the counting depends on
 * nothing else.
 */
function appWith(options: Parameters<typeof rateLimit>[0], clientIp: string | undefined = "203.0.113.1") {
  const app = new Hono<ClientIpEnv>();
  app.onError(onError(createLogger("silent")));
  app.use("*", async (c, next) => {
    c.set("clientIp", clientIp);
    await next();
  });
  app.use("/api/*", rateLimit(options));
  app.get("/api/resources", (c) => c.text("ok"));
  app.get("/api/imports/github/repositories", (c) => c.text("ok"));
  return app;
}

describe("the general request limiter (ISSUE-7)", () => {
  it("allows requests up to the limit and refuses the one after", async () => {
    const app = appWith({ windowSeconds: 60, max: 3 });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect((await app.request("/api/resources")).status).toBe(200);
    }

    const refused = await app.request("/api/resources");
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: { code: "rate_limited" } });
    // So a client knows when to come back rather than retrying immediately.
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("counts each client separately, so one caller cannot lock everyone else out", async () => {
    const options = { windowSeconds: 60, max: 1 };
    const noisy = appWith(options, "203.0.113.1");
    expect((await noisy.request("/api/resources")).status).toBe(200);
    expect((await noisy.request("/api/resources")).status).toBe(429);

    // A second app would have its own buckets, so the quiet client is asked
    // of the *same* limiter — which is the thing worth checking.
    const shared = appWith(options, "203.0.113.1");
    expect((await shared.request("/api/resources")).status).toBe(200);
  });

  it("applies a tighter bucket to a prefix, counted apart from the default one", async () => {
    const app = appWith({
      windowSeconds: 60,
      max: 10,
      overrides: [{ prefix: "/api/imports", windowSeconds: 60, max: 1 }],
    });

    expect((await app.request("/api/imports/github/repositories")).status).toBe(200);
    expect((await app.request("/api/imports/github/repositories")).status).toBe(429);
    // The import bucket being full says nothing about the catalog's.
    expect((await app.request("/api/resources")).status).toBe(200);
  });

  it("lets a client back in once the window has passed", async () => {
    const app = appWith({ windowSeconds: 0.05, max: 1 });

    expect((await app.request("/api/resources")).status).toBe(200);
    expect((await app.request("/api/resources")).status).toBe(429);

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect((await app.request("/api/resources")).status).toBe(200);
  });

  it("shares one bucket for requests with no knowable address, rather than exempting them", async () => {
    // `undefined` is what a request behind an untrusted proxy resolves to —
    // it must not be a way out of the limit.
    const app = appWith({ windowSeconds: 60, max: 1 }, undefined);

    expect((await app.request("/api/resources")).status).toBe(200);
    expect((await app.request("/api/resources")).status).toBe(429);
  });

  it("leaves paths outside its mount alone", async () => {
    const app = appWith({ windowSeconds: 60, max: 1 });
    app.get("/assets/app.js", (c) => c.text("ok"));

    expect((await app.request("/api/resources")).status).toBe(200);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await app.request("/assets/app.js")).status).toBe(200);
    }
  });
});
