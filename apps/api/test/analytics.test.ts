import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Role } from "@skill-registry/shared";
import { eq } from "drizzle-orm";
import { setPasswordCredential } from "../src/auth/credential.js";
import { hashPassword } from "../src/auth/password.js";
import { resourceInstallEvents, users } from "../src/db/schemas/index.js";
import {
  refreshInstallCounts,
  SIGN_IN_PATH,
  startTestContext,
  stopTestContext,
  type TestContext,
  SESSION_COOKIE_NAME,
} from "./setup.js";

interface ApiSkill {
  id: string;
  installs: number;
}

interface ApiInstallTrend {
  points: { date: string; count: number }[];
}

interface ApiPage {
  items: ApiSkill[];
}

interface ApiError {
  error: { code: string; message: string; field?: string };
}

interface Session {
  cookie: string;
  email: string;
  id: string;
}

function sessionCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("Response did not set a session cookie.");
  const match = new RegExp(`${SESSION_COOKIE_NAME}=([^;]*)`).exec(setCookie);
  if (!match) throw new Error(`Set-Cookie header missing "${SESSION_COOKIE_NAME}": ${setCookie}`);
  return `${SESSION_COOKIE_NAME}=${match[1]}`;
}

/** Same seeding approach as tags.test.ts and skills.test.ts — see their comments for why. */
async function createUserAndLogIn(
  context: TestContext,
  body: { first_name: string; last_name: string; email: string; password: string; role: Role },
): Promise<Session> {
  const [row] = await context.db
    .insert(users)
    .values({
      first_name: body.first_name,
      last_name: body.last_name,
      email: body.email,
      role: body.role,
    })
    .returning();
  if (!row) throw new Error("Insert did not return the created User.");

  await setPasswordCredential(context.db, row.id, await hashPassword(body.password));

  const res = await context.app.request(SIGN_IN_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: body.email, password: body.password }),
  });
  if (res.status !== 200) throw new Error(`Login failed for ${body.email}: ${res.status}`);
  return { cookie: sessionCookie(res), email: body.email, id: row.id };
}

async function publish(context: TestContext, session: Session, name: string): Promise<string> {
  const res = await context.app.request(`/api/resources/skill/${name}`, {
    method: "PUT",
    headers: { cookie: session.cookie, "content-type": "application/json" },
    body: JSON.stringify({ description: "A Skill.", body: "Body.\n" }),
  });
  const { skill } = (await res.json()) as { skill: ApiSkill };
  return skill.id;
}

async function download(context: TestContext, session: Session, skillId: string): Promise<Response> {
  return context.app.request(`/api/resources/${skillId}/artifact`, {
    headers: { cookie: session.cookie },
    redirect: "manual",
  });
}

async function getSkill(context: TestContext, session: Session, skillId: string): Promise<ApiSkill> {
  const res = await context.app.request(`/api/resources/${skillId}`, { headers: { cookie: session.cookie } });
  return (await res.json()) as ApiSkill;
}

async function getInstallTrend(context: TestContext, session: Session, skillId: string): Promise<Response> {
  return context.app.request(`/api/resources/${skillId}/installs/trend`, { headers: { cookie: session.cookie } });
}

const PASSWORD = "correct-horse-battery";

/**
 * Seam 1 — the API request boundary (spec: `.scratch/skill-analytics/spec.md`,
 * ADR-0012). No server listens; `app.request(...)` calls the Hono app directly
 * against a real Postgres and a fake storage adapter. A download only ever
 * appends a `skill_install_events` row — `installs` reflects it only once
 * `refreshInstallCounts` runs, which every test below calls directly rather
 * than waiting on `ANALYTICS_REFRESH_CRON` (that schedule is wired only in
 * `server.ts`, never in the test app).
 */
describe("Recording installs (ticket 22)", () => {
  let container: StartedPostgreSqlContainer;
  let context: TestContext;
  let writer: Session;
  let reader: Session;

  beforeAll(async () => {
    const started = await startTestContext();
    container = started.container;
    context = started.context;

    await context.app.request("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ first_name: "Ada", last_name: "Lovelace", email: "ada@example.com", password: PASSWORD }),
    });
    writer = await createUserAndLogIn(context, {
      first_name: "Grace",
      last_name: "Hopper",
      email: "grace@example.com",
      password: PASSWORD,
      role: "writer",
    });
    reader = await createUserAndLogIn(context, {
      first_name: "Margaret",
      last_name: "Hamilton",
      email: "margaret@example.com",
      password: PASSWORD,
      role: "reader",
    });
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  it("reads 0 for a Skill that has never been downloaded, on both the detail and list reads", async () => {
    const skillId = await publish(context, writer, "never-installed-skill");
    await refreshInstallCounts(context);

    const skill = await getSkill(context, reader, skillId);
    expect(skill.installs).toBe(0);

    const page = await context.app.request("/api/resources?page=1", { headers: { cookie: reader.cookie } });
    const { items } = (await page.json()) as ApiPage;
    expect(items.find((item) => item.id === skillId)?.installs).toBe(0);
  });

  it("does not reflect a download until skill_analytics is next refreshed", async () => {
    const skillId = await publish(context, writer, "lagging-skill");
    await context.storage.put(`resources/${skillId}.zip`, new Uint8Array([1]));
    await refreshInstallCounts(context);

    await download(context, reader, skillId);
    // No refresh yet: the download landed a row in skill_install_events, but
    // skill_analytics — and therefore `installs` — hasn't caught up (ADR-0012).
    expect((await getSkill(context, reader, skillId)).installs).toBe(0);

    await refreshInstallCounts(context);
    expect((await getSkill(context, reader, skillId)).installs).toBe(1);
  });

  it("increments by 1 each time the Artifact is downloaded, once refreshed", async () => {
    const skillId = await publish(context, writer, "counted-skill");
    await context.storage.put(`resources/${skillId}.zip`, new Uint8Array([1]));

    const first = await download(context, reader, skillId);
    expect(first.status).toBe(302);
    await refreshInstallCounts(context);
    expect((await getSkill(context, reader, skillId)).installs).toBe(1);

    const second = await download(context, reader, skillId);
    expect(second.status).toBe(302);
    await refreshInstallCounts(context);
    expect((await getSkill(context, reader, skillId)).installs).toBe(2);
  });

  it("accumulates correctly under concurrent downloads — no lost updates", async () => {
    const skillId = await publish(context, writer, "concurrent-skill");
    await context.storage.put(`resources/${skillId}.zip`, new Uint8Array([1]));

    await Promise.all(Array.from({ length: 10 }, () => download(context, reader, skillId)));
    await refreshInstallCounts(context);

    expect((await getSkill(context, reader, skillId)).installs).toBe(10);
  });

  it("does not count a download of an Artifact that was never uploaded", async () => {
    const skillId = await publish(context, writer, "abandoned-analytics-skill");

    const res = await download(context, reader, skillId);
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("artifact_missing");

    await refreshInstallCounts(context);
    expect((await getSkill(context, reader, skillId)).installs).toBe(0);
  });

  it("survives a republish of the same Skill unchanged", async () => {
    const skillId = await publish(context, writer, "republished-analytics-skill");
    await context.storage.put(`resources/${skillId}.zip`, new Uint8Array([1]));
    await download(context, reader, skillId);
    await refreshInstallCounts(context);

    const republished = await context.app.request("/api/resources/skill/republished-analytics-skill", {
      method: "PUT",
      headers: { cookie: writer.cookie, "content-type": "application/json" },
      body: JSON.stringify({ description: "Updated.", body: "New body.\n" }),
    });
    const { skill } = (await republished.json()) as { skill: ApiSkill };
    expect(skill.installs).toBe(1);
  });

  it("records every download as its own event, tagged with source 'web'", async () => {
    const skillId = await publish(context, writer, "event-sourced-skill");
    await context.storage.put(`resources/${skillId}.zip`, new Uint8Array([1]));

    await download(context, reader, skillId);
    await download(context, reader, skillId);

    const events = await context.db.select().from(resourceInstallEvents).where(eq(resourceInstallEvents.resource_id, skillId));
    expect(events.length).toBe(2);
    expect(events.every((event) => event.source === "web")).toBe(true);
  });

  it("exposes no public endpoint to record an install directly", async () => {
    const skillId = await publish(context, writer, "no-public-endpoint-skill");

    const res = await context.app.request(`/api/resources/${skillId}/installs`, {
      method: "POST",
      headers: { cookie: reader.cookie, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);

    await refreshInstallCounts(context);
    expect((await getSkill(context, reader, skillId)).installs).toBe(0);
  });
});

/**
 * The install trend chart's data source. Unlike `installs` above, this reads
 * `resource_install_events` directly rather than the periodically-refreshed
 * `resource_analytics` view — so, unlike every other install count in the
 * app, it needs no `refreshInstallCounts` to reflect a just-recorded Install.
 */
describe("Install trend (installs/trend)", () => {
  let container: StartedPostgreSqlContainer;
  let context: TestContext;
  let writer: Session;
  let reader: Session;

  beforeAll(async () => {
    const started = await startTestContext();
    container = started.container;
    context = started.context;

    await context.app.request("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ first_name: "Ada", last_name: "Lovelace", email: "ada@example.com", password: PASSWORD }),
    });
    writer = await createUserAndLogIn(context, {
      first_name: "Grace",
      last_name: "Hopper",
      email: "grace@example.com",
      password: PASSWORD,
      role: "writer",
    });
    reader = await createUserAndLogIn(context, {
      first_name: "Margaret",
      last_name: "Hamilton",
      email: "margaret@example.com",
      password: PASSWORD,
      role: "reader",
    });
  }, 60_000);

  afterAll(async () => {
    await stopTestContext(context, container);
  });

  it("returns 30 zero-filled days, oldest first, ending today, for a Skill with no Installs", async () => {
    const skillId = await publish(context, writer, "trendless-skill");

    const res = await getInstallTrend(context, reader, skillId);
    expect(res.status).toBe(200);
    const { points } = (await res.json()) as ApiInstallTrend;

    expect(points.length).toBe(30);
    expect(points.every((point) => point.count === 0)).toBe(true);

    const today = new Date().toISOString().slice(0, 10);
    expect(points.at(-1)?.date).toBe(today);
    // Ascending: each day's date string sorts before the next.
    for (let i = 1; i < points.length; i++) {
      expect(points[i - 1]!.date < points[i]!.date).toBe(true);
    }
  });

  it("counts today's Installs without waiting on refreshInstallCounts", async () => {
    const skillId = await publish(context, writer, "trending-skill");
    await context.storage.put(`resources/${skillId}.zip`, new Uint8Array([1]));

    await download(context, reader, skillId);
    await download(context, reader, skillId);
    // Deliberately no refreshInstallCounts call: the trend reads the event
    // log directly, not the materialized view `installs` lags behind.

    const { points } = (await (await getInstallTrend(context, reader, skillId)).json()) as ApiInstallTrend;
    expect(points.at(-1)?.count).toBe(2);
    expect(points.slice(0, -1).every((point) => point.count === 0)).toBe(true);
  });

  it("returns 404 for a Skill that does not exist", async () => {
    const res = await getInstallTrend(context, reader, crypto.randomUUID());
    expect(res.status).toBe(404);
  });
});
