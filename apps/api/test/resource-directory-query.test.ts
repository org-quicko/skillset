import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { registerErrorHandler } from "../src/http/errors.js";
import { parseResourceDirectoryQuery, type ResourceDirectoryQuery } from "../src/http/resource-directory-query.js";
import { createLogger } from "../src/logger.js";
import type { AuthVariables } from "../src/auth/middleware.js";

const A_TAG_ID = "018f4c1e-9b3a-7c2d-8e41-5f6a7b8c9d01";
const ANOTHER_TAG_ID = "018f4c1e-9b3a-7c2d-8e41-5f6a7b8c9d02";

interface Refusal {
  error: { code: string; message: string; field?: string };
}

/**
 * Drives `parseResourceDirectoryQuery` through a real request, with the API's
 * own error handler mounted — so a refusal is asserted as the 400 a caller
 * actually receives rather than as a thrown class.
 *
 * No database, no container: the query string is the whole input.
 */
const app = new Hono<{ Variables: AuthVariables }>();
registerErrorHandler(app, createLogger("silent"));
app.get("/resources", (c) => c.json(parseResourceDirectoryQuery(c)));

async function get(query: string): Promise<Response> {
  return app.request(`/resources${query}`);
}

async function parsed(query: string): Promise<Partial<ResourceDirectoryQuery>> {
  const res = await get(query);
  expect(res.status).toBe(200);
  return res.json() as Promise<Partial<ResourceDirectoryQuery>>;
}

describe("parseResourceDirectoryQuery — defaults", () => {
  it("answers every member from an empty query string", async () => {
    expect(await parsed("")).toEqual({
      page: 1,
      pageSize: 10,
      q: undefined,
      kind: undefined,
      tagIds: [],
      // ADR-0028: installs are not comparable across Kinds, so the default
      // moved off them.
      sortBy: "updated_at",
      sortOrder: "desc",
    });
  });
});

describe("parseResourceDirectoryQuery — page", () => {
  it("takes a whole number as given", async () => {
    expect(await parsed("?page=3")).toMatchObject({ page: 3 });
  });

  // A stale bookmark or a hand-edited URL should show a reader something,
  // so a page that cannot exist is the first page rather than a refusal.
  it.each([
    ["below one", "?page=0"],
    ["negative", "?page=-2"],
    ["not a number", "?page=abc"],
    ["fractional", "?page=1.5"],
    ["blank", "?page="],
  ])("falls back to the first page when %s", async (_case, query) => {
    expect(await parsed(query)).toMatchObject({ page: 1 });
  });
});

describe("parseResourceDirectoryQuery — page_size", () => {
  it("takes a size within range as given", async () => {
    expect(await parsed("?page_size=25")).toMatchObject({ pageSize: 25 });
  });

  // Clamped rather than refused, unlike the sort parameters: the ceiling is
  // what stops a caller asking for the whole table in one request.
  it("clamps above the maximum", async () => {
    expect(await parsed("?page_size=5000")).toMatchObject({ pageSize: 100 });
  });

  it("clamps below the minimum", async () => {
    expect(await parsed("?page_size=0")).toMatchObject({ pageSize: 1 });
  });

  it("falls back to the default when not a whole number", async () => {
    expect(await parsed("?page_size=lots")).toMatchObject({ pageSize: 10 });
  });
});

describe("parseResourceDirectoryQuery — q", () => {
  it("trims a term", async () => {
    expect(await parsed("?q=%20%20code%20review%20%20")).toMatchObject({ q: "code review" });
  });

  it.each([
    ["blank", "?q="],
    ["all whitespace", "?q=%20%20%20"],
  ])("treats a %s term as no search at all", async (_case, query) => {
    // Read off the result rather than matched as an object: `q` is dropped
    // from the JSON entirely when it is undefined, which is the same "no
    // search term" the service reads.
    expect((await parsed(query)).q).toBeUndefined();
  });
});

describe("parseResourceDirectoryQuery — kind", () => {
  it("takes a registered Kind as given", async () => {
    expect(await parsed("?kind=skill")).toMatchObject({ kind: "skill" });
  });

  it("is absent, not an error, when omitted — no Kind filter at all", async () => {
    expect((await parsed("")).kind).toBeUndefined();
  });

  it("refuses an unregistered Kind, naming the field and the known Kinds", async () => {
    const res = await get("?kind=mcp-server");
    const body = (await res.json()) as Refusal;

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.field).toBe("kind");
    expect(body.error.message).toBe("kind must be one of: skill.");
  });
});

describe("parseResourceDirectoryQuery — tag_id", () => {
  it("keeps every repetition of the parameter", async () => {
    expect(await parsed(`?tag_id=${A_TAG_ID}&tag_id=${ANOTHER_TAG_ID}`)).toMatchObject({
      tagIds: [A_TAG_ID, ANOTHER_TAG_ID],
    });
  });

  // One typo must not cost a caller the ids they got right, and a non-UUID
  // reaching a `tags.id` comparison would be a 500 for what is really a
  // narrowing hint.
  it("drops a malformed id and keeps the rest", async () => {
    expect(await parsed(`?tag_id=${A_TAG_ID}&tag_id=not-an-id`)).toMatchObject({ tagIds: [A_TAG_ID] });
  });

  it("drops every id when none is well-formed", async () => {
    expect(await parsed("?tag_id=nope&tag_id=also-nope")).toMatchObject({ tagIds: [] });
  });
});

describe("parseResourceDirectoryQuery — sorting", () => {
  it("takes a recognised sort_by and sort_order", async () => {
    expect(await parsed("?sort_by=updated_at&sort_order=asc")).toMatchObject({
      sortBy: "updated_at",
      sortOrder: "asc",
    });
  });

  it("still accepts sort_by=installs, just not as the default", async () => {
    expect(await parsed("?sort_by=installs")).toMatchObject({ sortBy: "installs" });
  });

  // Refused rather than defaulted, and that split from `page` is deliberate:
  // a bad page has an obvious right answer, a bad sort does not, and quietly
  // sorting by something else is worse than saying so.
  it("refuses an unrecognised sort_by, naming the field and the options", async () => {
    const res = await get("?sort_by=nonsense");
    const body = (await res.json()) as Refusal;

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.field).toBe("sort_by");
    expect(body.error.message).toBe("sort_by must be one of: installs, updated_at.");
  });

  it("refuses an unrecognised sort_order, naming the field and the options", async () => {
    const res = await get("?sort_order=sideways");
    const body = (await res.json()) as Refusal;

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.field).toBe("sort_order");
    expect(body.error.message).toBe("sort_order must be one of: asc, desc.");
  });
});
