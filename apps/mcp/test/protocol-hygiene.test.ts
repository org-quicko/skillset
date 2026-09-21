import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import type { McpConfig } from "../src/config.js";
import type { Logger } from "../src/logger.js";
import { jsonResponse, stubFetch } from "./helpers.js";

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const CTX = { cwd: process.cwd(), env: {}, homeDir: process.cwd() };

function baseConfig(overrides: Partial<McpConfig> = {}): McpConfig {
  return {
    registry: "https://registry.example",
    scope: "project",
    agentId: undefined,
    logLevel: "warn",
    token: undefined,
    tokenSource: "none",
    ...overrides,
  };
}

function skillEntry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "skill-1",
    kind: "skill",
    name: "code-review",
    description: "Reviews code for style and correctness.",
    published_by_name: "A B",
    updated_at: "2026-09-20T00:00:00.000Z",
    installs: 3,
    tags: [{ id: "t1", name: "quality" }],
    ...overrides,
  };
}

const TAGS = [
  { id: "t1", name: "quality" },
  { id: "t2", name: "testing" },
];

function fakePage(items: unknown[], total = items.length, page = 1, pageSize = 10) {
  return { items, page, page_size: pageSize, total };
}

/** Answers every Registry endpoint this server's tools and resources touch, for one Skill carrying one Tag. */
function stubRegistry() {
  return stubFetch((url) => {
    const u = new URL(url);
    if (u.pathname === "/api/tags") return jsonResponse(200, { items: TAGS });
    if (u.pathname === "/api/resources") {
      const q = u.searchParams.get("q");
      const tagId = u.searchParams.get("tag_id");
      const entry = skillEntry();
      let items = [entry];
      if (tagId && tagId !== "t1") items = [];
      if (q && !entry.name.includes(q) && !entry.description.includes(q)) items = [];
      return jsonResponse(200, fakePage(items));
    }
    if (u.pathname === "/api/resources/skill/by-name/code-review") {
      return jsonResponse(200, {
        id: "skill-1",
        kind: "skill",
        name: "code-review",
        description: "Reviews code for style and correctness.",
        body: "# Code Review\n\nHow to review code.\n",
        published_by: { user_id: "u1", email: "a@example.com", first_name: "A", last_name: "B" },
        published_at: "2026-09-20T00:00:00.000Z",
        updated_at: "2026-09-20T00:00:00.000Z",
        license: null,
        compatibility: null,
        metadata: null,
        allowed_tools: null,
        tags: [{ id: "t1", name: "quality" }],
        installs: 3,
      });
    }
    if (u.pathname === "/api/resources/skill-1/files") return jsonResponse(200, { files: [{ path: "SKILL.md", size: 42 }] });
    return new Response("not found", { status: 404 });
  });
}

async function connect(config: McpConfig, fetchImpl: typeof fetch) {
  const server = createServer(config, fetchImpl, noopLogger, CTX);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe("outputSchema — every tool's structuredContent is declared and validates", () => {
  it("declares an outputSchema on every registered tool", async () => {
    const { client, close } = await connect(baseConfig(), stubRegistry().fetch);
    try {
      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThan(0);
      for (const tool of tools) {
        expect(tool.outputSchema, `${tool.name} has no outputSchema`).toBeTruthy();
      }
    } finally {
      await close();
    }
  });

  it("returns structuredContent the SDK accepts against search_skills's own outputSchema", async () => {
    const { client, close } = await connect(baseConfig(), stubRegistry().fetch);
    try {
      // The SDK client validates a tool's structuredContent against its own outputSchema
      // before resolving callTool — a mismatch throws rather than being returned.
      const result = await client.callTool({ name: "search_skills", arguments: {} });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toBeTruthy();
    } finally {
      await close();
    }
  });

  it("validates read_skill's structuredContent against its outputSchema", async () => {
    const { client, close } = await connect(baseConfig(), stubRegistry().fetch);
    try {
      const result = await client.callTool({ name: "read_skill", arguments: { name: "code-review" } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({ skill: { name: "code-review" } });
    } finally {
      await close();
    }
  });
});

describe("publish_skill — reports failure as an isError result", () => {
  it("returns isError rather than throwing when no writer Token is configured", async () => {
    const { client, close } = await connect(baseConfig({ token: undefined }), stubRegistry().fetch);
    try {
      const result = await client.callTool({ name: "publish_skill", arguments: {} });
      expect(result.isError).toBe(true);
      const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
      // The message is read by a person through the Agent, not acted on by the Agent itself —
      // it must tell the Agent to relay it, not instruct the Agent to restart anything itself.
      expect(text).toContain("Tell the User");
      expect(text).not.toMatch(/^publish_skill needs a writer Token — configure one/);
    } finally {
      await close();
    }
  });

  it("returns isError, not a thrown protocol error, when the Registry refuses the publish", async () => {
    const { fetch: fetchImpl } = stubFetch(() => new Response("nope", { status: 500 }));
    const { client, close } = await connect(baseConfig({ token: "writer-token" }), fetchImpl);
    try {
      const result = await client.callTool({ name: "publish_skill", arguments: {} });
      expect(result.isError).toBe(true);
    } finally {
      await close();
    }
  });
});

describe("pagination — search_skills pages past its own limit via cursor", () => {
  function pagedFetch() {
    return stubFetch((url) => {
      const u = new URL(url);
      if (u.pathname === "/api/tags") return jsonResponse(200, { items: [] });
      const page = Number(u.searchParams.get("page") ?? "1");
      const item = skillEntry({ id: `skill-${page}`, name: `skill-${page}` });
      return jsonResponse(200, fakePage([item], 2, page, 1));
    });
  }

  it("hands back a next_cursor when more Skills exist past this page", async () => {
    const { client, close } = await connect(baseConfig(), pagedFetch().fetch);
    try {
      const first = await client.callTool({ name: "search_skills", arguments: { limit: 1 } });
      expect(first.structuredContent).toMatchObject({ page: 1, page_size: 1, next_cursor: "2" });
    } finally {
      await close();
    }
  });

  it("fetches the next page when the previous next_cursor is passed back as cursor", async () => {
    const { client, close } = await connect(baseConfig(), pagedFetch().fetch);
    try {
      const first = await client.callTool({ name: "search_skills", arguments: { limit: 1 } });
      const cursor = (first.structuredContent as { next_cursor: string }).next_cursor;

      const second = await client.callTool({ name: "search_skills", arguments: { limit: 1, cursor } });
      expect(second.structuredContent).toMatchObject({ page: 2, next_cursor: null });
      expect((second.structuredContent as { results: { name: string }[] }).results[0]?.name).toBe("skill-2");
    } finally {
      await close();
    }
  });
});

describe("resources — the catalog is reachable as MCP resources, not only through tools", () => {
  it("lists a resource per Skill and per Tag", async () => {
    const { client, close } = await connect(baseConfig(), stubRegistry().fetch);
    try {
      const { resources } = await client.listResources();
      expect(resources.some((r) => r.uri === "skillset://skills/code-review")).toBe(true);
      expect(resources.some((r) => r.uri === "skillset://tags/quality")).toBe(true);
    } finally {
      await close();
    }
  });

  it("advertises both resource templates", async () => {
    const { client, close } = await connect(baseConfig(), stubRegistry().fetch);
    try {
      const { resourceTemplates } = await client.listResourceTemplates();
      const uris = resourceTemplates.map((t) => t.uriTemplate);
      expect(uris).toContain("skillset://skills/{name}");
      expect(uris).toContain("skillset://tags/{tag}");
    } finally {
      await close();
    }
  });

  it("reads a Skill's SKILL.md body through its resource, without calling read_skill", async () => {
    const { client, close } = await connect(baseConfig(), stubRegistry().fetch);
    try {
      const { contents } = await client.readResource({ uri: "skillset://skills/code-review" });
      const content = contents[0]!;
      expect(content.mimeType).toBe("text/markdown");
      expect("text" in content && content.text).toContain("How to review code.");
    } finally {
      await close();
    }
  });

  it("reads a Tag's member Skills through its resource", async () => {
    const { client, close } = await connect(baseConfig(), stubRegistry().fetch);
    try {
      const { contents } = await client.readResource({ uri: "skillset://tags/quality" });
      const content = contents[0]!;
      const skills = JSON.parse("text" in content ? content.text : "");
      expect(skills).toEqual([{ name: "code-review", description: "Reviews code for style and correctness." }]);
    } finally {
      await close();
    }
  });

  it("completes a Skill name against the catalog", async () => {
    const { client, close } = await connect(baseConfig(), stubRegistry().fetch);
    try {
      const result = await client.complete({
        ref: { type: "ref/resource", uri: "skillset://skills/{name}" },
        argument: { name: "name", value: "code" },
      });
      expect(result.completion.values).toContain("code-review");
    } finally {
      await close();
    }
  });

  it("completes a Tag name against the catalog", async () => {
    const { client, close } = await connect(baseConfig(), stubRegistry().fetch);
    try {
      const result = await client.complete({
        ref: { type: "ref/resource", uri: "skillset://tags/{tag}" },
        argument: { name: "tag", value: "qual" },
      });
      expect(result.completion.values).toContain("quality");
    } finally {
      await close();
    }
  });
});
