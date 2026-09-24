import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { buildDiscoveryDocument, DISCOVERY_PATH, formatDiscoveryDocument } from "../src/discovery.js";

describe("docs/mcp.json, the discovery document GET /mcp serves", () => {
  it("matches what the server itself reports — regenerate it with `bun run --filter @in-org-quicko/skillset-mcp discovery`", async () => {
    const committed = (await readFile(DISCOVERY_PATH, "utf8")).replaceAll("\r\n", "\n");
    expect(committed).toBe(formatDiscoveryDocument(await buildDiscoveryDocument()));
  });

  it("lists every tool with its full description and input schema", async () => {
    const document = await buildDiscoveryDocument();

    expect(document.tools.map((tool) => tool.name).sort()).toEqual([
      "install_skills",
      "installed_skills",
      "publish_skill",
      "read_skill",
      "remove_skills",
      "search_skills",
      "update_skills",
    ]);
    const publish = document.tools.find((tool) => tool.name === "publish_skill");
    expect(publish?.description).toContain("`url`");
    expect(Object.keys(publish?.inputSchema.properties ?? {})).toEqual(["path", "url", "name"]);
  });
});
