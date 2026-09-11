import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { users } from "../../db/schemas/index.js";
import { startTestContext, stopTestContext, type TestContext } from "../../../test/context.js";

/**
 * Isolated from auth.test.ts's story so a real race — several bootstrap
 * attempts in flight together — can be exercised without disturbing the
 * fixed superadmin identity the rest of that suite depends on.
 */
describe("Setup initialisation under concurrency", () => {
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

  it("lets exactly one of several concurrent signups through", async () => {
    const attempts = Array.from({ length: 5 }, (_, i) =>
      context.app.request("/api/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          first_name: "Racer",
          last_name: `${i}`,
          email: `racer-${i}@example.com`,
          password: "correct-horse-battery",
        }),
      }),
    );

    const responses = await Promise.all(attempts);
    const statuses = responses.map((res) => res.status).sort();

    expect(statuses).toEqual([201, 409, 409, 409, 409]);

    const rows = await context.db.select().from(users);
    expect(rows.length).toBe(1);
  }, 15_000);
});
