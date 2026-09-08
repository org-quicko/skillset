import { describe, expect, it } from "bun:test";
import { searchSkills } from "../src/search-skills.js";
import { jsonResponse, stubFetch } from "./helpers.js";

function fakeEntry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "skill-1",
    kind: "skill",
    name: "code-review",
    description: "Reviews code for style and correctness.",
    published_by_name: "A B",
    updated_at: new Date().toISOString(),
    installs: 3,
    tags: [],
    ...overrides,
  };
}

function fakePage(items: unknown[]) {
  return { items, page: 1, page_size: 10, total: items.length };
}

describe("searchSkills", () => {
  it("returns each match's name and description", async () => {
    const { fetch: fetchImpl } = stubFetch(() => jsonResponse(200, fakePage([fakeEntry()])));

    const results = await searchSkills(fetchImpl, "https://registry.example", { query: "code review" });

    expect(results).toEqual([{ name: "code-review", description: "Reviews code for style and correctness." }]);
  });

  it("returns an empty array, not an error, when nothing matches", async () => {
    const { fetch: fetchImpl } = stubFetch(() => jsonResponse(200, fakePage([])));

    const results = await searchSkills(fetchImpl, "https://registry.example", { query: "nothing like this exists" });

    expect(results).toEqual([]);
  });

  it("requests the skill Kind, and passes the query, Tag filter, and result cap through", async () => {
    const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, fakePage([])));

    await searchSkills(fetchImpl, "https://registry.example", { query: "review", tag: "tag-1", limit: 5 });

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/api/resources");
    expect(url.searchParams.get("q")).toBe("review");
    expect(url.searchParams.get("kind")).toBe("skill");
    expect(url.searchParams.get("tag_id")).toBe("tag-1");
    expect(url.searchParams.get("page_size")).toBe("5");
  });

  it("omits tag_id and page_size when not given", async () => {
    const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, fakePage([])));

    await searchSkills(fetchImpl, "https://registry.example", { query: "review" });

    const url = new URL(calls[0]!.url);
    expect(url.searchParams.has("tag_id")).toBe(false);
    expect(url.searchParams.has("page_size")).toBe(false);
  });

  it("sends no authorization header — reads need none (ADR-0013)", async () => {
    const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, fakePage([])));

    await searchSkills(fetchImpl, "https://registry.example", { query: "review" });

    expect(calls[0]!.init?.headers).toBeUndefined();
  });

  it("throws when the Registry answers with a non-2xx status", async () => {
    const { fetch: fetchImpl } = stubFetch(() => new Response("nope", { status: 500 }));

    await expect(searchSkills(fetchImpl, "https://registry.example", { query: "review" })).rejects.toThrow();
  });
});
