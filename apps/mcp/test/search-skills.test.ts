import { describe, expect, it } from "bun:test";
import { searchSkills } from "../src/tools/search-skills.js";
import { jsonResponse, stubFetch } from "./helpers.js";

const UPDATED_AT = "2026-09-20T00:00:00.000Z";

function fakeEntry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "skill-1",
    kind: "skill",
    name: "code-review",
    description: "Reviews code for style and correctness.",
    published_by_name: "A B",
    updated_at: UPDATED_AT,
    installs: 3,
    tags: [],
    ...overrides,
  };
}

function fakePage(items: unknown[], total = items.length, page = 1, pageSize = 10) {
  return { items, page, page_size: pageSize, total };
}

/** Answers the Tag catalog on `/api/tags` and the search on `/api/resources`. */
function stubRegistry(page: unknown, tags: { id: string; name: string }[] = []) {
  return stubFetch((url) => {
    if (url.startsWith("https://registry.example/api/tags")) return jsonResponse(200, { items: tags });
    return jsonResponse(200, page);
  });
}

describe("searchSkills", () => {
  // An Agent choosing between two similar Skills needs more than a summary:
  // Tags say what each is for, and `updated_at` says which is maintained.
  it("returns each match with its Tags, last update, and install count", async () => {
    const { fetch: fetchImpl } = stubRegistry(
      fakePage([fakeEntry({ tags: [{ id: "t1", name: "quality" }] })]),
    );

    const response = await searchSkills(fetchImpl, "https://registry.example", { query: "code review" });

    expect(response.results).toEqual([
      {
        name: "code-review",
        description: "Reviews code for style and correctness.",
        tags: ["quality"],
        updated_at: UPDATED_AT,
        installs: 3,
      },
    ]);
  });

  it("returns an empty result set, not an error, when nothing matches", async () => {
    const { fetch: fetchImpl } = stubRegistry(fakePage([]));

    const response = await searchSkills(fetchImpl, "https://registry.example", { query: "nothing like this" });

    expect(response).toEqual({ results: [], total: 0, truncated: false, page: 1, page_size: 10, next_cursor: null });
  });

  // Without this there is no way for an Agent to see the catalog at all —
  // it would have to guess a search term to discover what exists.
  it("lists the whole catalog when no query is given", async () => {
    const { fetch: fetchImpl, calls } = stubRegistry(fakePage([fakeEntry()]));

    const response = await searchSkills(fetchImpl, "https://registry.example", {});

    expect(response.results).toHaveLength(1);
    expect(new URL(calls[0]!.url).searchParams.has("q")).toBe(false);
  });

  it("treats a blank query as no query rather than searching for nothing", async () => {
    const { fetch: fetchImpl, calls } = stubRegistry(fakePage([fakeEntry()]));

    await searchSkills(fetchImpl, "https://registry.example", { query: "   " });

    expect(new URL(calls[0]!.url).searchParams.has("q")).toBe(false);
  });

  it("says when there were more matches than it returned", async () => {
    const { fetch: fetchImpl } = stubRegistry(fakePage([fakeEntry()], 42));

    const response = await searchSkills(fetchImpl, "https://registry.example", { query: "review" });

    expect(response).toMatchObject({ total: 42, truncated: true });
  });

  it("requests the skill Kind, and passes the query and result cap through", async () => {
    const { fetch: fetchImpl, calls } = stubRegistry(fakePage([]));

    await searchSkills(fetchImpl, "https://registry.example", { query: "review", limit: 5 });

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/api/resources");
    expect(url.searchParams.get("q")).toBe("review");
    expect(url.searchParams.get("kind")).toBe("skill");
    expect(url.searchParams.get("page_size")).toBe("5");
  });

  // Nothing an Agent can call hands back a Tag id, so the tool takes the
  // name a human would use and resolves it here.
  it("resolves a Tag's name to the id the Registry filters on", async () => {
    const { fetch: fetchImpl, calls } = stubRegistry(fakePage([]), [
      { id: "018f4c1e-9b3a-7c2d-8e41-5f6a7b8c9d01", name: "quality" },
    ]);

    await searchSkills(fetchImpl, "https://registry.example", { query: "review", tag: "quality" });

    const search = calls.find((call) => call.url.includes("/api/resources"));
    expect(new URL(search!.url).searchParams.get("tag_id")).toBe("018f4c1e-9b3a-7c2d-8e41-5f6a7b8c9d01");
  });

  it("names the Tags that do exist when asked for one that does not", async () => {
    const { fetch: fetchImpl } = stubRegistry(fakePage([]), [
      { id: "t1", name: "quality" },
      { id: "t2", name: "testing" },
    ]);

    await expect(
      searchSkills(fetchImpl, "https://registry.example", { tag: "nonexistent" }),
    ).rejects.toThrow(/Available Tags: quality, testing/);
  });

  it("hands back a next_cursor when the Registry has more past this page", async () => {
    const { fetch: fetchImpl } = stubRegistry(fakePage([fakeEntry()], 25, 1, 10));

    const response = await searchSkills(fetchImpl, "https://registry.example", { limit: 10 });

    expect(response).toMatchObject({ page: 1, page_size: 10, next_cursor: "2" });
  });

  it("has no next_cursor once page * page_size reaches the total", async () => {
    const { fetch: fetchImpl } = stubRegistry(fakePage([fakeEntry()], 25, 3, 10));

    const response = await searchSkills(fetchImpl, "https://registry.example", { limit: 10, cursor: "3" });

    expect(response).toMatchObject({ next_cursor: null, truncated: false });
  });

  it("sends cursor through as the Registry's page parameter", async () => {
    const { fetch: fetchImpl, calls } = stubRegistry(fakePage([], 0, 2, 10));

    await searchSkills(fetchImpl, "https://registry.example", { cursor: "2" });

    expect(new URL(calls[0]!.url).searchParams.get("page")).toBe("2");
  });

  it("omits page when no cursor is given, leaving the Registry's own default page", async () => {
    const { fetch: fetchImpl, calls } = stubRegistry(fakePage([]));

    await searchSkills(fetchImpl, "https://registry.example", { query: "review" });

    expect(new URL(calls[0]!.url).searchParams.has("page")).toBe(false);
  });

  it("omits tag_id and page_size when not given", async () => {
    const { fetch: fetchImpl, calls } = stubRegistry(fakePage([]));

    await searchSkills(fetchImpl, "https://registry.example", { query: "review" });

    const url = new URL(calls[0]!.url);
    expect(url.searchParams.has("tag_id")).toBe(false);
    expect(url.searchParams.has("page_size")).toBe(false);
  });

  // Left unset so the Registry ranks by relevance for a query and by
  // recency for a bare listing, rather than this pinning one of them.
  it("sends no sort_by, leaving the Registry's own default to apply", async () => {
    const { fetch: fetchImpl, calls } = stubRegistry(fakePage([]));

    await searchSkills(fetchImpl, "https://registry.example", { query: "review" });

    expect(new URL(calls[0]!.url).searchParams.has("sort_by")).toBe(false);
  });

  it("sends no authorization header — reads need none (ADR-0013)", async () => {
    const { fetch: fetchImpl, calls } = stubRegistry(fakePage([]));

    await searchSkills(fetchImpl, "https://registry.example", { query: "review" });

    expect(calls[0]!.init?.headers).toBeUndefined();
  });

  it("throws when the Registry answers with a non-2xx status", async () => {
    const { fetch: fetchImpl } = stubFetch(() => new Response("nope", { status: 500 }));

    await expect(searchSkills(fetchImpl, "https://registry.example", { query: "review" })).rejects.toThrow();
  });
});
