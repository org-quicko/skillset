import { describe, expect, it } from "bun:test";
import type { ArtifactFile } from "@in-org-quicko/skillset-shared";
import { findArtifactFile, resolveArtifactPath } from "../src/lib/artifact-links";

describe("resolveArtifactPath", () => {
  it("resolves relative paths from the root file", () => {
    expect(resolveArtifactPath("SKILL.md", "references/api.md")).toBe("references/api.md");
    expect(resolveArtifactPath("SKILL.md", "./references/api.md")).toBe("references/api.md");
    expect(resolveArtifactPath("SKILL.md", "guide.md")).toBe("guide.md");
  });

  it("resolves relative paths from nested directories", () => {
    expect(resolveArtifactPath("references/overview.md", "details.md")).toBe(
      "references/details.md",
    );
    expect(resolveArtifactPath("references/overview.md", "./details.md")).toBe(
      "references/details.md",
    );
    expect(resolveArtifactPath("references/overview.md", "../SKILL.md")).toBe("SKILL.md");
    expect(resolveArtifactPath("references/sub/deep.md", "../../SKILL.md")).toBe("SKILL.md");
    expect(resolveArtifactPath("references/sub/deep.md", "../api.md")).toBe("references/api.md");
  });

  it("resolves root-relative paths starting with slash", () => {
    expect(resolveArtifactPath("references/sub/deep.md", "/SKILL.md")).toBe("SKILL.md");
    expect(resolveArtifactPath("references/sub/deep.md", "/references/api.md")).toBe(
      "references/api.md",
    );
    expect(resolveArtifactPath("SKILL.md", "/scripts/build.sh")).toBe("scripts/build.sh");
  });

  it("strips fragments and query strings", () => {
    expect(resolveArtifactPath("SKILL.md", "references/api.md#endpoints")).toBe(
      "references/api.md",
    );
    expect(resolveArtifactPath("SKILL.md", "references/api.md?version=2#section")).toBe(
      "references/api.md",
    );
  });

  it("handles percent-encoded paths", () => {
    expect(resolveArtifactPath("SKILL.md", "references/user%20guide.md")).toBe(
      "references/user guide.md",
    );
  });

  it("clamps directory traversal so it cannot escape above the artifact root", () => {
    expect(resolveArtifactPath("SKILL.md", "../../../etc/passwd")).toBe("etc/passwd");
    expect(resolveArtifactPath("references/doc.md", "../../outside.md")).toBe("outside.md");
  });

  it("returns null for in-page anchors and empty hrefs", () => {
    expect(resolveArtifactPath("SKILL.md", "")).toBeNull();
    expect(resolveArtifactPath("SKILL.md", "   ")).toBeNull();
    expect(resolveArtifactPath("SKILL.md", "#heading")).toBeNull();
    expect(resolveArtifactPath("SKILL.md", "#")).toBeNull();
  });

  it("returns null for external URLs and protocols", () => {
    expect(resolveArtifactPath("SKILL.md", "https://github.com/org-quicko/skillset")).toBeNull();
    expect(resolveArtifactPath("SKILL.md", "http://localhost:5173/skills/foo")).toBeNull();
    expect(resolveArtifactPath("SKILL.md", "mailto:user@example.com")).toBeNull();
    expect(resolveArtifactPath("SKILL.md", "//example.com/file.md")).toBeNull();
  });
});

describe("findArtifactFile", () => {
  const sampleFiles: ArtifactFile[] = [
    { path: "SKILL.md", size: 1200 },
    { path: "references/api.md", size: 3400 },
    { path: "references/sub/details.md", size: 850 },
    { path: "docs/index.md", size: 2100 },
    { path: "guides/README.md", size: 1500 },
    { path: "scripts/setup.sh", size: 400 },
  ];

  it("finds exact path matches", () => {
    const file = findArtifactFile(sampleFiles, "references/api.md");
    expect(file).toBeDefined();
    expect(file?.path).toBe("references/api.md");
  });

  it("finds files when .md extension is omitted in the link", () => {
    const file = findArtifactFile(sampleFiles, "references/api");
    expect(file).toBeDefined();
    expect(file?.path).toBe("references/api.md");
  });

  it("finds directory index files", () => {
    const docs = findArtifactFile(sampleFiles, "docs");
    expect(docs).toBeDefined();
    expect(docs?.path).toBe("docs/index.md");

    const guides = findArtifactFile(sampleFiles, "guides");
    expect(guides).toBeDefined();
    expect(guides?.path).toBe("guides/README.md");
  });

  it("falls back to case-insensitive match", () => {
    const file = findArtifactFile(sampleFiles, "References/Api.md");
    expect(file).toBeDefined();
    expect(file?.path).toBe("references/api.md");
  });

  it("returns undefined when file does not exist", () => {
    expect(findArtifactFile(sampleFiles, "missing.md")).toBeUndefined();
    expect(findArtifactFile(sampleFiles, "references/nonexistent.md")).toBeUndefined();
    expect(findArtifactFile(sampleFiles, "")).toBeUndefined();
  });
});
