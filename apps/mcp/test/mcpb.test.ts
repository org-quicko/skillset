import { describe, expect, it } from "bun:test";
import { v0_3 } from "@anthropic-ai/mcpb";
import pkg from "../package.json" with { type: "json" };
import { parseConfig } from "../src/config.js";
import { buildDiscoveryDocument } from "../src/discovery.js";
import { buildMcpbManifest, MCPB_NAME } from "../src/mcpb.js";

describe("the generated MCPB manifest", () => {
  it("is a valid MCPB 0.3 manifest", async () => {
    const result = v0_3.McpbManifestSchema.safeParse(buildMcpbManifest(await buildDiscoveryDocument()));
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });

  it("takes its version and description from package.json, so a release cannot ship a stale one", async () => {
    const manifest = buildMcpbManifest(await buildDiscoveryDocument());
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.description).toBe(pkg.description);
  });

  it("lists every tool the server registers, with the description an Agent sees", async () => {
    const discovery = await buildDiscoveryDocument();
    const manifest = buildMcpbManifest(discovery);

    expect(manifest.tools).toEqual(discovery.tools.map((tool) => ({ name: tool.name, description: tool.description ?? "" })));
  });

  // Claude Code and Cowork refuse to start a bundle whose name contains
  // `skillset` anywhere (ADR-0037).
  it("keeps the substring `skillset` out of its name", () => {
    expect(MCPB_NAME.toLowerCase()).not.toContain("skillset");
  });

  it("runs the server so that installs go to user scope", async () => {
    const manifest = buildMcpbManifest(await buildDiscoveryDocument());
    const config = parseConfig(manifest.server.mcp_config.args ?? [], {});

    expect(config.scope).toBe("user");
  });
});
