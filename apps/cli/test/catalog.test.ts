import { describe, expect, it } from "bun:test";
import { runInfo } from "../src/commands/info.js";
import { runSearch } from "../src/commands/search.js";
import type { SessionDeps } from "../src/session.js";
import { jsonResponse, stubFetch } from "./helpers.js";

const REGISTRY = "https://registry.example";
const UPDATED_AT = "2026-09-20T00:00:00.000Z";

function deps(fetchImpl: typeof fetch): SessionDeps {
  return { fetch: fetchImpl, configPath: "/unused/config.json", env: { SKILLSET_REGISTRY: REGISTRY } };
}

function entry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "skill-1",
    kind: "skill",
    name: "code-review",
    description: "Reviews code.",
    published_by_name: "Ada Lovelace",
    updated_at: UPDATED_AT,
    installs: 3,
    allowed_tools: null,
    source: "com.example.registry",
    tags: [],
    ...overrides,
  };
}

function page(items: unknown[], total = items.length) {
  return { items, page: 1, page_size: 10, total };
}

function skill(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "skill-1",
    kind: "skill",
    name: "code-review",
    description: "Reviews code.",
    body: "# How to review\n",
    published_by: { user_id: "u1", email: "ada@example.com", first_name: "Ada", last_name: "Lovelace" },
    published_at: UPDATED_AT,
    updated_at: UPDATED_AT,
    license: null,
    compatibility: null,
    metadata: null,
    allowed_tools: null,
    source: "com.example.registry",
    tags: [],
    installs: 3,
    ...overrides,
  };
}

describe("runSearch", () => {
  it("errors when no Registry is configured, before any network call", async () => {
    const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, page([])));
    await expect(runSearch({ fetch: fetchImpl, configPath: "/nope.json", env: {} }, {})).rejects.toThrow(
      /No Registry configured/,
    );
    expect(calls).toHaveLength(0);
  });

  it("returns each match", async () => {
    const { fetch: fetchImpl } = stubFetch(() => jsonResponse(200, page([entry()])));

    const report = await runSearch(deps(fetchImpl), { query: "code review" });

    expect(report.items.map((item) => item.name)).toEqual(["code-review"]);
    expect(report).toMatchObject({ total: 1, truncated: false });
  });

  // Without this there is no way to see the catalog from a terminal at all.
  it("lists everything when given no term", async () => {
    const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, page([entry()])));

    await runSearch(deps(fetchImpl), {});

    const url = new URL(calls[0]!.url);
    expect(url.searchParams.has("q")).toBe(false);
    expect(url.searchParams.get("kind")).toBe("skill");
  });

  it("treats a blank term as no term rather than searching for nothing", async () => {
    const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, page([])));

    await runSearch(deps(fetchImpl), { query: "   " });

    expect(new URL(calls[0]!.url).searchParams.has("q")).toBe(false);
  });

  it("says when more matched than came back", async () => {
    const { fetch: fetchImpl } = stubFetch(() => jsonResponse(200, page([entry()], 42)));

    expect(await runSearch(deps(fetchImpl), { query: "review" })).toMatchObject({ total: 42, truncated: true });
  });

  // Nobody types a Tag id, so the flag takes the name and resolves it.
  it("resolves a Tag name to the id the Registry filters on", async () => {
    const { fetch: fetchImpl, calls } = stubFetch((url) =>
      url.includes("/api/tags")
        ? jsonResponse(200, { items: [{ id: "018f4c1e-9b3a-7c2d-8e41-5f6a7b8c9d01", name: "quality" }] })
        : jsonResponse(200, page([])),
    );

    await runSearch(deps(fetchImpl), { query: "review", tag: "quality" });

    const search = calls.find((call) => call.url.includes("/api/resources"));
    expect(new URL(search!.url).searchParams.get("tag_id")).toBe("018f4c1e-9b3a-7c2d-8e41-5f6a7b8c9d01");
  });

  it("names the Tags that do exist when asked for one that does not", async () => {
    const { fetch: fetchImpl } = stubFetch((url) =>
      url.includes("/api/tags")
        ? jsonResponse(200, { items: [{ id: "t1", name: "quality" }, { id: "t2", name: "testing" }] })
        : jsonResponse(200, page([])),
    );

    await expect(runSearch(deps(fetchImpl), { tag: "nonexistent" })).rejects.toThrow(
      /Available Tags: quality, testing/,
    );
  });

  // Refused rather than ignored: a silently dropped flag looks like it worked.
  it.each([
    ["not a number", "lots"],
    ["zero", "0"],
    ["negative", "-5"],
    ["fractional", "2.5"],
  ])("refuses a --limit that is %s, before any network call", async (_case, limit) => {
    const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, page([])));

    await expect(runSearch(deps(fetchImpl), { limit })).rejects.toThrow(/--limit must be a positive whole number/);
    expect(calls).toHaveLength(0);
  });

  // Left off so the Registry ranks by relevance for a term and by recency
  // for a bare listing (ADR-0039), rather than this pinning one of them.
  it("sends no sort_by, leaving the Registry's own default to apply", async () => {
    const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, page([])));

    await runSearch(deps(fetchImpl), { query: "review" });

    expect(new URL(calls[0]!.url).searchParams.has("sort_by")).toBe(false);
  });

  it("sends no authorization header — reads need none (ADR-0013)", async () => {
    const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, page([])));

    await runSearch(deps(fetchImpl), { query: "review" });

    expect(calls[0]!.init?.headers).not.toHaveProperty("authorization");
  });
});

describe("runInfo", () => {
  it("returns the Skill and its body", async () => {
    const { fetch: fetchImpl } = stubFetch(() => jsonResponse(200, skill()));

    const report = await runInfo(deps(fetchImpl), { name: "code-review" });

    expect(report.skill.body).toBe("# How to review\n");
    expect(report.files).toBeNull();
  });

  // Reading is not obtaining (ADR-0028), and only the zip endpoint records
  // an Install — so this must never touch it.
  it("never requests the Artifact, so it records no Install", async () => {
    const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, skill()));

    await runInfo(deps(fetchImpl), { name: "code-review" });

    expect(calls.some((call) => call.url.includes("/artifact"))).toBe(false);
  });

  it("lists the Skill's files only when asked", async () => {
    const { fetch: fetchImpl, calls } = stubFetch((url) =>
      url.includes("/files")
        ? jsonResponse(200, { files: [{ path: "SKILL.md", size: 42 }] })
        : jsonResponse(200, skill()),
    );

    const report = await runInfo(deps(fetchImpl), { name: "code-review", files: true });

    expect(report.files?.map((file) => file.path)).toEqual(["SKILL.md"]);
    expect(calls.some((call) => call.url.includes("/files"))).toBe(true);
  });

  it("costs only one request when files were not asked for", async () => {
    const { fetch: fetchImpl, calls } = stubFetch(() => jsonResponse(200, skill()));

    await runInfo(deps(fetchImpl), { name: "code-review" });

    expect(calls).toHaveLength(1);
  });

  // A bare 404 leaves someone who mistyped with nowhere to go.
  it("points at search when there is no such Skill", async () => {
    const { fetch: fetchImpl } = stubFetch(() =>
      jsonResponse(404, { error: { code: "not_found", message: "No Resource by that id." } }),
    );

    await expect(runInfo(deps(fetchImpl), { name: "no-such-skill" })).rejects.toThrow(/skillset search/);
  });

  it("passes any other refusal through untouched", async () => {
    const { fetch: fetchImpl } = stubFetch(() =>
      jsonResponse(500, { error: { code: "internal_error", message: "Something broke." } }),
    );

    await expect(runInfo(deps(fetchImpl), { name: "code-review" })).rejects.toThrow(/Something broke/);
  });
});
