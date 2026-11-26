import { describe, expect, it } from "bun:test";
import {
  buildPluginBundle,
  PluginComponentsSchema,
  PluginValidationError,
  validatePluginAgents,
  validatePluginFiles,
  validatePluginName,
  type SkillFile,
} from "../src/index.js";

const encode = (text: string) => new TextEncoder().encode(text);

function file(path: string, text: string): SkillFile {
  return { path, bytes: encode(text) };
}

const MANIFEST = file(
  ".claude-plugin/plugin.json",
  JSON.stringify({ name: "review-suite", description: "Reviews code.", version: "1.2.0", license: "MIT" }),
);

function ruleOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof PluginValidationError) return error.rule;
    throw error;
  }
  return undefined;
}

describe("buildPluginBundle", () => {
  it("reads the name and fields from the Claude Code manifest and the README as the body", () => {
    const bundle = buildPluginBundle([MANIFEST, file("README.md", "# Review suite"), file("commands/review.md", "Review.")]);
    expect(bundle.name).toBe("review-suite");
    expect(bundle.request).toMatchObject({
      description: "Reviews code.",
      body: "# Review suite",
      agents: ["claude-code"],
      version: "1.2.0",
      license: "MIT",
    });
    expect(bundle.request.files.map((f) => f.path)).toEqual(bundle.files.map((f) => f.path));
  });

  it("strips one wrapping folder, as dropping the folder itself gives", () => {
    const bundle = buildPluginBundle([
      file("review-suite/.claude-plugin/plugin.json", MANIFEST.bytes ? new TextDecoder().decode(MANIFEST.bytes) : ""),
      file("review-suite/commands/review.md", "Review."),
    ]);
    expect(bundle.files.map((f) => f.path).sort()).toEqual([".claude-plugin/plugin.json", "commands/review.md"]);
  });

  it("has no body when there is no README", () => {
    expect(buildPluginBundle([MANIFEST]).request.body).toBeNull();
  });

  it("refuses a folder with no agent manifest", () => {
    expect(ruleOf(() => buildPluginBundle([file("SKILL.md", "---\nname: x\n---")]))).toBe("manifest_missing");
  });

  it("refuses a manifest that is not JSON, or has no description", () => {
    expect(ruleOf(() => buildPluginBundle([file(".claude-plugin/plugin.json", "{")]))).toBe("manifest_invalid");
    expect(
      ruleOf(() => buildPluginBundle([file(".claude-plugin/plugin.json", JSON.stringify({ name: "review-suite" }))])),
    ).toBe("description_required");
  });
});

describe("validatePluginName", () => {
  it("accepts kebab-case, including names Anthropic's own plugins use, and refuses anything else", () => {
    expect(validatePluginName("review-suite")).toBe("review-suite");
    expect(validatePluginName("claude-md-management")).toBe("claude-md-management");
    expect(ruleOf(() => validatePluginName("Review Suite"))).toBe("name_invalid");
  });
});

describe("validatePluginAgents", () => {
  it("accepts agents that match the manifests, and refuses ones that do not", () => {
    expect(validatePluginAgents(["claude-code"], [".claude-plugin/plugin.json"])).toEqual(["claude-code"]);
    expect(ruleOf(() => validatePluginAgents([], [".claude-plugin/plugin.json"]))).toBe("agents_invalid");
    expect(ruleOf(() => validatePluginAgents(["claude-code"], ["README.md"]))).toBe("manifest_missing");
  });
});

describe("validatePluginFiles", () => {
  it("needs an agent manifest, not a SKILL.md", () => {
    expect(validatePluginFiles([{ path: ".claude-plugin/plugin.json", size: 10 }])).toHaveLength(1);
    expect(ruleOf(() => validatePluginFiles([{ path: "SKILL.md", size: 10 }]))).toBe("manifest_missing");
  });
});

describe("buildPluginBundle's file filter", () => {
  it("keeps the dot paths Claude Code reads and still drops version control and editor files", () => {
    const bundle = buildPluginBundle([
      MANIFEST,
      file(".mcp.json", "{}"),
      file(".git/HEAD", "ref"),
      file(".claude-plugin/.DS_Store", ""),
      file("commands/.hidden.md", "x"),
    ]);
    expect(bundle.files.map((f) => f.path).sort()).toEqual([".claude-plugin/plugin.json", ".mcp.json"]);
  });
});

describe("buildPluginBundle's components", () => {
  it("lists skills, commands, agents, hook events, and MCP servers from the default layout", () => {
    const bundle = buildPluginBundle([
      MANIFEST,
      file("skills/lint/SKILL.md", "---\nname: lint\ndescription: Lints code.\n---\nBody"),
      file("commands/review.md", "---\ndescription: Review a diff.\n---\nReview"),
      file("agents/reviewer.md", "---\nname: code-reviewer\ndescription: Reviews code.\n---\n"),
      file("hooks/hooks.json", JSON.stringify({ hooks: { PostToolUse: [], SessionStart: [] } })),
      file(".mcp.json", JSON.stringify({ mcpServers: { github: { command: "npx", args: ["-y", "gh-mcp"] }, docs: { url: "https://docs.example/mcp" } } })),
      file("skills/lint/references/rules.md", "Not a skill"),
    ]);
    const { components } = bundle.request;
    expect(components.skills).toEqual([{ name: "lint", description: "Lints code.", path: "skills/lint/SKILL.md" }]);
    expect(components.commands).toEqual([{ name: "review", description: "Review a diff.", path: "commands/review.md" }]);
    expect(components.agents.map((a) => a.name)).toEqual(["code-reviewer"]);
    expect(components.hooks.map((h) => h.name)).toEqual(["PostToolUse", "SessionStart"]);
    expect(components.mcp_servers).toEqual([
      { name: "github", description: "npx -y gh-mcp", path: ".mcp.json" },
      { name: "docs", description: "https://docs.example/mcp", path: ".mcp.json" },
    ]);
  });

  it("lists the mods hooks.json names under modules, beside its hook events", () => {
    const bundle = buildPluginBundle([
      MANIFEST,
      file("hooks/hooks.json", JSON.stringify({ hooks: { Stop: [] }, modules: ["./register.tsx"] })),
      file("hooks/register.tsx", "export const register = () => {};"),
    ]);
    expect(bundle.request.components.hooks.map((h) => h.name)).toEqual(["Stop"]);
    expect(bundle.request.components.mods).toEqual([
      { name: "register.tsx", description: null, path: "hooks/register.tsx" },
    ]);
  });

  it("resolves a mod's module from the hooks folder, and leaves out one the plugin does not hold", () => {
    const bundle = buildPluginBundle([
      MANIFEST,
      file("hooks/hooks.json", JSON.stringify({ modules: ["../src/mod.ts", "./missing.ts", "../../outside.ts", 7] })),
      file("src/mod.ts", "export const register = () => {};"),
    ]);
    expect(bundle.request.components.mods.map((m) => m.path)).toEqual(["src/mod.ts"]);
  });

  it("reads components recorded before mods existed as having none", () => {
    const parsed = PluginComponentsSchema.parse({ skills: [], commands: [], agents: [], hooks: [], mcp_servers: [] });
    expect(parsed.mods).toEqual([]);
  });

  it("lists a component whose frontmatter does not parse by its file name, without failing the publish", () => {
    const bundle = buildPluginBundle([MANIFEST, file("commands/broken.md", "---\n: [\n---\n"), file(".mcp.json", "{")]);
    expect(bundle.request.components.commands).toEqual([{ name: "broken", description: null, path: "commands/broken.md" }]);
    expect(bundle.request.components.mcp_servers).toEqual([]);
  });
});

describe("a Plugin's agents, from the manifests it holds", () => {
  const manifest = (path: string, name = "review-suite") =>
    file(path, JSON.stringify({ name, description: "Reviews code." }));

  it("lists every agent whose manifest folder is present, and only those", () => {
    const bundle = buildPluginBundle([
      manifest(".claude-plugin/plugin.json"),
      manifest(".cursor-plugin/plugin.json"),
      manifest(".codex-plugin/plugin.json"),
    ]);
    expect(bundle.request.agents).toEqual(["claude-code", "cursor", "codex"]);
    expect(buildPluginBundle([manifest(".cursor-plugin/plugin.json")]).request.agents).toEqual(["cursor"]);
  });

  it("keeps each agent's own dot folder in the Artifact", () => {
    const bundle = buildPluginBundle([manifest(".cursor-plugin/plugin.json"), manifest(".codex-plugin/plugin.json")]);
    expect(bundle.files.map((f) => f.path).sort()).toEqual([".codex-plugin/plugin.json", ".cursor-plugin/plugin.json"]);
  });

  it("refuses manifests that disagree on the name", () => {
    expect(
      ruleOf(() =>
        buildPluginBundle([manifest(".claude-plugin/plugin.json"), manifest(".cursor-plugin/plugin.json", "other")]),
      ),
    ).toBe("name_mismatch");
  });

  it("lists the MCP servers in Cursor's mcp.json", () => {
    const bundle = buildPluginBundle([
      manifest(".cursor-plugin/plugin.json"),
      file("mcp.json", JSON.stringify({ mcpServers: { docs: { url: "https://docs.example/mcp" } } })),
    ]);
    expect(bundle.request.components.mcp_servers).toEqual([
      { name: "docs", description: "https://docs.example/mcp", path: "mcp.json" },
    ]);
  });
});
