import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { startTestContext, stopTestContext, type TestContext } from "../test/context.js";

/**
 * Seam 1 — the API request boundary: no server listens, `app.request(...)`
 * calls the Hono app directly against a real Postgres and a fake storage
 * adapter, per the spec's testing decisions.
 */
describe("API request boundary", () => {
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

  it("answers a health check via a real database round trip", async () => {
    const res = await context.app.request("/api/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
