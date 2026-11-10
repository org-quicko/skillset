import { describe, expect, it } from "bun:test";
import {
  buildSubagentBundle,
  kindConfig,
  parseSubagentDocument,
  ResourcePayloadSchema,
  SkillValidationError,
  validateSubagentManifest,
} from "../src/index.js";

const rule = (run: () => unknown): string | undefined => {
  try {
    run();
  } catch (error) {
    if (error instanceof SkillValidationError) return error.rule;
    throw error;
  }
  return undefined;
};

const doc = (frontmatter: string, body = "You review code.\n") => `---\n${frontmatter}\n---\n${body}`;

describe("parseSubagentDocument", () => {
  it("reads name, description, tools, model and the system prompt", () => {
    expect(parseSubagentDocument(doc("name: code-reviewer\ndescription: Reviews a diff.\ntools: Read, Grep\nmodel: sonnet"))).toEqual({
      name: "code-reviewer",
      description: "Reviews a diff.",
      tools: "Read, Grep",
      model: "sonnet",
      body: "You review code.\n",
    });
  });

  it("folds tools written as a YAML list into a comma-separated string", () => {
    const parsed = parseSubagentDocument(doc("name: a\ndescription: b\ntools:\n  - Read\n  - Bash(rg:*)"));
    expect(parsed.tools).toBe("Read, Bash(rg:*)");
  });

  it("leaves unset optional fields absent and ignores keys it does not model", () => {
    const parsed = parseSubagentDocument(doc("name: a\ndescription: b\ncolor: blue"));
    expect(parsed).toEqual({ name: "a", description: "b", body: "You review code.\n" });
  });

  it("refuses a file with no frontmatter, a bad name, a blank prompt, or a non-string field", () => {
    expect(rule(() => parseSubagentDocument("just a prompt"))).toBe("frontmatter_missing");
    expect(rule(() => parseSubagentDocument(doc("name: Code Reviewer\ndescription: b")))).toBe("name_invalid");
    expect(rule(() => parseSubagentDocument(doc("name: a")))).toBe("description_required");
    expect(rule(() => parseSubagentDocument(doc("name: a\ndescription: b", "  \n")))).toBe("body_required");
    expect(rule(() => parseSubagentDocument(doc("name: a\ndescription: b\ntools: 3")))).toBe("tools_invalid");
    expect(rule(() => parseSubagentDocument(doc("name: a\ndescription: b\nmodel: [x]")))).toBe("model_invalid");
  });
});

describe("validateSubagentManifest", () => {
  it("accepts exactly the one file named after the Subagent", () => {
    expect(validateSubagentManifest("reviewer", [{ path: "reviewer.md", size: 10 }])).toEqual([{ path: "reviewer.md", size: 10 }]);
  });

  it("refuses a differently named file, or more than one", () => {
    expect(rule(() => validateSubagentManifest("reviewer", [{ path: "other.md", size: 10 }]))).toBe("manifest_invalid");
    expect(
      rule(() =>
        validateSubagentManifest("reviewer", [
          { path: "reviewer.md", size: 10 },
          { path: "notes.md", size: 10 },
        ]),
      ),
    ).toBe("manifest_invalid");
  });
});

describe("buildSubagentBundle", () => {
  it("names the upload after the Subagent, whatever the file was called on disk", () => {
    const bytes = new TextEncoder().encode(doc("name: reviewer\ndescription: Reviews.\nmodel: opus"));
    const bundle = buildSubagentBundle(bytes, { source: "https://github.com/acme/agents" });
    expect(bundle.name).toBe("reviewer");
    expect(bundle.file).toEqual({ path: "reviewer.md", bytes });
    expect(bundle.request).toEqual({
      description: "Reviews.",
      model: "opus",
      body: "You review code.\n",
      source: "https://github.com/acme/agents",
      files: [{ path: "reviewer.md", size: bytes.byteLength }],
    });
  });
});

describe("the subagent Kind", () => {
  it("is registered with an Artifact and its own payload shape", () => {
    expect(kindConfig("subagent").hasArtifact).toBe(true);
    expect(ResourcePayloadSchema.safeParse({ kind: "subagent", tools: null, model: "sonnet" }).success).toBe(true);
    expect(ResourcePayloadSchema.safeParse({ kind: "subagent", tools: null }).success).toBe(false);
  });
});
