import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  seedUserWithPassword,
  signIn,
  startTestContext,
  stopTestContext,
  type TestContext,
} from "../../../test/context.js";

const SOURCE = "https://github.com/acme/skills";
const SKILL_MD = "---\nname: pdf\ndescription: Reads PDFs.\n---\nBody.\n";

interface ApiSubmission {
  id: string;
  namespace: string;
  name: string;
  source: string;
  submitted_by_email: string;
}

let context: TestContext;
let container: StartedPostgreSqlContainer;
let reader: string;
let writer: string;
let admin: string;

beforeAll(async () => {
  ({ context, container } = await startTestContext());
  const password = "correct-horse-battery";
  await seedUserWithPassword(context, { first_name: "Rea", last_name: "Der", email: "reader@example.com", password, role: "reader" });
  await seedUserWithPassword(context, { first_name: "Wri", last_name: "Ter", email: "writer@example.com", password, role: "writer" });
  await seedUserWithPassword(context, { first_name: "Ad", last_name: "Min", email: "admin@example.com", password, role: "admin" });
  reader = await signIn(context, "reader@example.com", password);
  writer = await signIn(context, "writer@example.com", password);
  admin = await signIn(context, "admin@example.com", password);
}, 120_000);

afterAll(async () => {
  await stopTestContext(context, container);
});

beforeEach(async () => {
  await context.db.deleteFrom("resource_submissions").execute();
  await context.db.deleteFrom("resources").execute();
});

async function submit(cookie: string, body: Record<string, unknown> = {}): Promise<Response> {
  return context.app.request("/api/submissions/skill/pdf", {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      description: "Reads PDFs.",
      body: "Body.\n",
      source: SOURCE,
      files: [{ path: "SKILL.md", size: SKILL_MD.length }],
      ...body,
    }),
  });
}

/** Submits, then does what the CLI does with the presigned URL: writes the file to storage. */
async function submitAndUpload(cookie: string): Promise<ApiSubmission> {
  const res = await submit(cookie);
  expect(res.status).toBe(200);
  const { submission } = (await res.json()) as { submission: ApiSubmission };
  await context.storage.put(`submissions/${submission.id}/SKILL.md`, new TextEncoder().encode(SKILL_MD));
  return submission;
}

async function approve(cookie: string, id: string): Promise<Response> {
  return context.app.request(`/api/submissions/${id}/approve`, { method: "POST", headers: { cookie } });
}

describe("Submitting a Resource (PUT /submissions/{kind}/{name})", () => {
  it("lets a reader submit, naming it by the repository it came from", async () => {
    const res = await submit(reader);

    expect(res.status).toBe(200);
    const { submission, upload } = (await res.json()) as {
      submission: ApiSubmission;
      upload: { files: { path: string }[] };
    };
    expect(submission).toMatchObject({ namespace: "acme/skills", name: "pdf", source: SOURCE, submitted_by_email: "reader@example.com" });
    expect(upload.files.map((file) => file.path)).toEqual(["SKILL.md"]);
  });

  it("does not put the Submission in the catalog", async () => {
    await submitAndUpload(reader);

    const res = await context.app.request("/api/resources/skill/by-name/pdf?namespace=acme%2Fskills");
    expect(res.status).toBe(404);
  });

  it("replaces a pending Submission of the same Resource rather than queueing a second", async () => {
    const first = await submitAndUpload(reader);
    await context.storage.put(`submissions/${first.id}/stale.md`, new Uint8Array([1]));

    await submit(writer);

    const list = await context.app.request("/api/submissions", { headers: { cookie: admin } });
    const { items } = (await list.json()) as { items: ApiSubmission[] };
    expect(items).toHaveLength(1);
    expect(items[0]?.submitted_by_email).toBe("writer@example.com");
    expect(await context.storage.list(`submissions/${first.id}/`)).toEqual([]);
  });

  it("refuses a Submission with no source", async () => {
    const res = await submit(reader, { source: undefined });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("source_required");
  });

  it("refuses a Resource already in the Registry", async () => {
    const approved = await submitAndUpload(reader);
    await approve(admin, approved.id);

    const res = await submit(reader);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("already_published");
  });

  it("refuses an anonymous caller", async () => {
    const res = await context.app.request("/api/submissions/skill/pdf", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "Reads PDFs.", body: "Body.\n", source: SOURCE, files: [] }),
    });
    expect(res.status).toBe(401);
  });
});

describe("Reviewing Submissions", () => {
  it("lists pending Submissions for an Admin and refuses a writer", async () => {
    await submitAndUpload(reader);

    expect((await context.app.request("/api/submissions", { headers: { cookie: writer } })).status).toBe(403);
    const res = await context.app.request("/api/submissions", { headers: { cookie: admin } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { items: ApiSubmission[] }).items.map((item) => item.name)).toEqual(["pdf"]);
  });

  it("approving turns the Submission into a Resource, credited to the submitter, with its files", async () => {
    const submission = await submitAndUpload(reader);

    const res = await approve(admin, submission.id);
    expect(res.status).toBe(200);
    const skill = (await res.json()) as { id: string; namespace: string; source: string; published_by: { email: string } };
    expect(skill).toMatchObject({ namespace: "acme/skills", source: SOURCE, published_by: { email: "reader@example.com" } });

    const files = await context.app.request(`/api/resources/${skill.id}/files`);
    expect(((await files.json()) as { files: { path: string }[] }).files.map((file) => file.path)).toEqual(["SKILL.md"]);
    expect(await context.storage.list(`submissions/${submission.id}/`)).toEqual([]);
    const list = await context.app.request("/api/submissions", { headers: { cookie: admin } });
    expect(((await list.json()) as { items: ApiSubmission[] }).items).toEqual([]);
  });

  it("refuses to approve a Submission whose files were never uploaded", async () => {
    const res = await submit(reader);
    const { submission } = (await res.json()) as { submission: ApiSubmission };

    const approved = await approve(admin, submission.id);
    expect(approved.status).toBe(409);
    expect(((await approved.json()) as { error: { code: string } }).error.code).toBe("submission_incomplete");
  });

  it("refuses a writer's approval", async () => {
    const submission = await submitAndUpload(reader);
    expect((await approve(writer, submission.id)).status).toBe(403);
  });

  it("rejecting discards the Submission and its files", async () => {
    const submission = await submitAndUpload(reader);

    const res = await context.app.request(`/api/submissions/${submission.id}`, { method: "DELETE", headers: { cookie: admin } });
    expect(res.status).toBe(204);
    expect(await context.storage.list(`submissions/${submission.id}/`)).toEqual([]);
    expect((await approve(admin, submission.id)).status).toBe(404);
  });
});
