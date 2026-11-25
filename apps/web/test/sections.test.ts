import { describe, expect, it } from "bun:test";
import { skillPath } from "../src/lib/routes";
import { sectionForPath } from "../src/lib/sections";

describe("sectionForPath", () => {
  it("puts the root and Skill pages in the Skills section", () => {
    expect(sectionForPath("/").kind).toBe("skill");
    expect(sectionForPath("/skills/pdf").kind).toBe("skill");
  });

  it("puts the MCP list and an MCP server's page in the MCP section", () => {
    expect(sectionForPath("/mcp-servers").kind).toBe("mcp");
    expect(sectionForPath("/mcp-servers/io.github.acme%2Fweather").kind).toBe("mcp");
  });

  it("puts the Plugins list in the Plugins section", () => {
    expect(sectionForPath("/plugins").kind).toBe("plugin");
  });

  it("does not treat a path that only starts with a section's name as that section", () => {
    expect(sectionForPath("/mcp-serversx").kind).toBe("skill");
  });
});

describe("skillPath", () => {
  it("links each Resource to a page its own section claims", () => {
    for (const kind of ["skill", "mcp"]) {
      expect(sectionForPath(skillPath("io.github.acme/weather", undefined, kind)).kind).toBe(kind);
    }
  });

  it("falls back to the Skills section for a Kind with no section", () => {
    expect(sectionForPath(skillPath("x", undefined, "agent")).kind).toBe("skill");
  });
});
