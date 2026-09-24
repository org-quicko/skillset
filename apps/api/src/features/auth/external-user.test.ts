import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createAuth } from "./instance.js";
import { createLogger } from "../../lib/logger.js";
import { deriveKeys } from "../../lib/secrets.js";
import {
  startTestContext,
  stopTestContext,
  TEST_AUTH_SECRET,
  TEST_PUBLIC_URL,
  type TestContext,
} from "../../../test/context.js";

/**
 * Drives `internalAdapter.createOAuthUser` — the writer an OAuth callback uses
 * for a first-time login — since the handshake itself is Better Auth's to exercise.
 */
describe("A first external login creates a User", () => {
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

  async function createUser(user: { email: string; name: string }) {
    const auth = createAuth(
      {
        db: context.db,
        secret: TEST_AUTH_SECRET,
        publicUrl: TEST_PUBLIC_URL,
        logger: createLogger("silent"),
        keys: deriveKeys(TEST_AUTH_SECRET),
      },
      [],
    );
    const ctx = await auth.$context;
    await ctx.internalAdapter.createOAuthUser(
      { ...user, emailVerified: true },
      { providerId: "github", accountId: `github-${user.email}` },
    );
    return context.db.selectFrom("users").selectAll().where("email", "=", user.email).executeTakeFirst();
  }

  it("splits the provider's name, leaving the generated column to Postgres", async () => {
    const row = await createUser({ email: "grace@example.com", name: "Grace Brewster Hopper" });

    expect(row?.first_name).toBe("Grace Brewster");
    expect(row?.last_name).toBe("Hopper");
    expect(row?.name).toBe("Grace Brewster Hopper");
  });

  it("is a reader, whatever the provider said", async () => {
    const row = await createUser({ email: "linus@example.com", name: "linus" });

    expect(row?.role).toBe("reader");
    expect(row?.first_name).toBe("linus");
    expect(row?.last_name).toBe("");
  });
});
