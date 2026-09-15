import { describe, expect, it } from "bun:test";
import {
  ARTIFACT_MAX_ENTRIES,
  ARTIFACT_MAX_UNCOMPRESSED_BYTES,
  artifactMediaType,
  buildArtifact,
  extractSkillFiles,
  SkillValidationError,
  splitFrontmatter,
  validateArtifactManifest,
  type ArtifactMediaKind,
  type SkillRule,
} from "../src/index.js";

const encoder = new TextEncoder();

/** The rule a manifest breaks, or that it breaks none — one assertion shape for every case below. */
function ruleFor(files: unknown): SkillRule | "no error" {
  try {
    validateArtifactManifest(files);
    return "no error";
  } catch (error) {
    if (error instanceof SkillValidationError) return error.rule;
    throw error;
  }
}

function manifest(...paths: string[]): { path: string; size: number }[] {
  return paths.map((path) => ({ path, size: 1 }));
}

/**
 * Seam 2 — the manifest is the *whole* of what the API knows about an
 * Artifact's shape (ADR-0032), since it still never reads the bytes
 * (ADR-0001). Everything a hostile or malformed layout could do has to be
 * refused here or not at all, so these are the cases that matter most in
 * this file.
 */
describe("Artifact manifest validation (ADR-0032)", () => {
  const cases: Array<{ label: string; files: unknown; expected: SkillRule | "no error" }> = [
    { label: "a SKILL.md alone", files: manifest("SKILL.md"), expected: "no error" },
    { label: "nested supporting files", files: manifest("SKILL.md", "references/style.md", "scripts/run.sh"), expected: "no error" },
    { label: "a zero-byte file", files: [{ path: "SKILL.md", size: 0 }], expected: "no error" },

    { label: "not an array", files: { "SKILL.md": 1 }, expected: "manifest_invalid" },
    { label: "a null entry", files: [null], expected: "manifest_invalid" },
    { label: "an entry with no path", files: [{ size: 1 }], expected: "manifest_invalid" },
    { label: "a non-string path", files: [{ path: 7, size: 1 }], expected: "manifest_invalid" },
    { label: "an entry with no size", files: [{ path: "SKILL.md" }], expected: "manifest_invalid" },
    { label: "a fractional size", files: [{ path: "SKILL.md", size: 1.5 }], expected: "manifest_invalid" },
    { label: "a negative size", files: [{ path: "SKILL.md", size: -1 }], expected: "manifest_invalid" },

    { label: "an empty list", files: [], expected: "skill_md_missing" },
    { label: "no root SKILL.md", files: manifest("readme.md"), expected: "skill_md_missing" },
    // The root SKILL.md is the one that counts — a nested one is a supporting
    // file, exactly as it is for a Skill that bundles other Skills' folders.
    { label: "only a nested SKILL.md", files: manifest("inner/SKILL.md"), expected: "skill_md_missing" },

    { label: "a parent-directory segment", files: manifest("SKILL.md", "../escape.md"), expected: "entry_path_traversal" },
    { label: "a parent segment mid-path", files: manifest("SKILL.md", "references/../../escape.md"), expected: "entry_path_traversal" },
    { label: "an absolute path", files: manifest("SKILL.md", "/etc/passwd"), expected: "entry_absolute_path" },
    { label: "a drive letter", files: manifest("SKILL.md", "C:/Windows/system.ini"), expected: "entry_absolute_path" },
    // A manifest's paths are normalised before anything checks them — the same
    // normalisation the client applies before uploading — so a backslash
    // becomes a separator and is then caught by the rule it was standing in
    // for, rather than by `entry_backslash`. That rule still guards the zip
    // extractor, which does not normalise. Either way the path is refused;
    // what these pin down is that normalising cannot be used to slip one past.
    { label: "a backslash escape", files: manifest("SKILL.md", "a\\..\\..\\escape.md"), expected: "entry_path_traversal" },
    { label: "a UNC path", files: manifest("SKILL.md", "\\\\server\\share"), expected: "entry_absolute_path" },
    { label: "a null byte", files: manifest("SKILL.md", "a\0b.md"), expected: "entry_null_byte" },
    { label: "a trailing slash", files: manifest("SKILL.md", "references/"), expected: "entry_not_a_file" },
    { label: "an empty path", files: manifest("SKILL.md", ""), expected: "entry_not_a_file" },
    { label: "a doubled slash", files: manifest("SKILL.md", "references//style.md"), expected: "entry_not_a_file" },

    { label: "the same path twice", files: manifest("SKILL.md", "a.md", "a.md"), expected: "entry_duplicate" },
    // Normalised first, so the two spellings collide rather than both becoming
    // storage keys.
    { label: "one path spelt two ways", files: manifest("SKILL.md", "a.md", "./a.md"), expected: "entry_duplicate" },
  ];

  for (const { label, files, expected } of cases) {
    it(`${expected === "no error" ? "accepts" : `refuses`} ${label}`, () => {
      expect(ruleFor(files)).toBe(expected);
    });
  }

  it(`refuses more than ${ARTIFACT_MAX_ENTRIES} files`, () => {
    const files = manifest("SKILL.md", ...Array.from({ length: ARTIFACT_MAX_ENTRIES }, (_, i) => `note-${i}.md`));
    expect(ruleFor(files)).toBe("too_many_entries");
  });

  it(`refuses declared sizes totalling more than ${ARTIFACT_MAX_UNCOMPRESSED_BYTES} bytes`, () => {
    expect(ruleFor([{ path: "SKILL.md", size: ARTIFACT_MAX_UNCOMPRESSED_BYTES + 1 }])).toBe("uncompressed_too_large");
  });

  it("normalises paths, so what comes back is what becomes a storage key", () => {
    const files = validateArtifactManifest([
      { path: "./SKILL.md", size: 6 },
      { path: "references\\style.md".replace("\\", "/"), size: 5 },
    ]);
    expect(files).toEqual([
      { path: "SKILL.md", size: 6 },
      { path: "references/style.md", size: 5 },
    ]);
  });

  it("names the offending path in `field`, not just in the message", () => {
    try {
      validateArtifactManifest(manifest("SKILL.md", "../escape.md"));
      throw new Error("expected a SkillValidationError");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillValidationError);
      expect((error as SkillValidationError).field).toBe("../escape.md");
    }
  });
});

/**
 * The zip is a representation the API assembles on demand rather than
 * something it stores (ADR-0032), so what matters is that it round-trips
 * through the extractor `sqillset add` uses.
 */
describe("Assembling an Artifact into a zip (ADR-0032)", () => {
  it("round-trips every file, at its own path, byte for byte", () => {
    const files = [
      { path: "SKILL.md", bytes: encoder.encode("---\nname: a\ndescription: b\n---\nBody.\n") },
      { path: "references/style.md", bytes: encoder.encode("# Style\n") },
      { path: "scripts/run.sh", bytes: encoder.encode("#!/bin/sh\necho hi\n") },
    ];

    const extracted = extractSkillFiles(buildArtifact(files));

    expect(extracted.map((file) => file.path).sort()).toEqual(["SKILL.md", "references/style.md", "scripts/run.sh"]);
    for (const original of files) {
      const found = extracted.find((file) => file.path === original.path);
      expect(found?.bytes).toEqual(original.bytes);
    }
  });

  it("refuses to build one from more files than an Artifact may hold", () => {
    const files = Array.from({ length: ARTIFACT_MAX_ENTRIES + 1 }, (_, i) => ({
      path: `note-${i}.md`,
      bytes: encoder.encode("note"),
    }));
    expect(() => buildArtifact(files)).toThrow(SkillValidationError);
  });
});

/**
 * Deciding a file's type from its path is the only option available — the
 * API has never read these bytes (ADR-0001) — and both the `content-type` it
 * serves and the viewer the interface reaches for come from this one answer.
 */
describe("Artifact media types (ADR-0032)", () => {
  const cases: Array<{ path: string; kind: ArtifactMediaKind; contentType?: string }> = [
    { path: "SKILL.md", kind: "text", contentType: "text/markdown; charset=utf-8" },
    { path: "references/style.markdown", kind: "text", contentType: "text/markdown; charset=utf-8" },
    { path: "notes.txt", kind: "text", contentType: "text/plain; charset=utf-8" },
    { path: "config.yaml", kind: "text", contentType: "text/yaml; charset=utf-8" },
    { path: "package.json", kind: "text", contentType: "application/json; charset=utf-8" },
    { path: "scripts/run.sh", kind: "text", contentType: "text/x-shellscript; charset=utf-8" },
    { path: "scripts/tool.py", kind: "text", contentType: "text/x-python; charset=utf-8" },
    { path: "src/index.ts", kind: "text", contentType: "application/typescript; charset=utf-8" },
    // Extensionless files that are nonetheless text, matched on the whole name.
    { path: "Dockerfile", kind: "text", contentType: "text/plain; charset=utf-8" },
    { path: "LICENSE", kind: "text", contentType: "text/plain; charset=utf-8" },
    { path: "Makefile", kind: "text", contentType: "text/plain; charset=utf-8" },
    // Matched on the stem before the first dot, so a suffixed variant still lands.
    { path: "Dockerfile.dev", kind: "text", contentType: "text/plain; charset=utf-8" },

    { path: "assets/logo.png", kind: "image", contentType: "image/png" },
    { path: "assets/photo.JPG", kind: "image", contentType: "image/jpeg" },
    // An image, not markup: an `<img src>` cannot run the script an inline
    // `<svg>` from an untrusted publisher could.
    { path: "assets/icon.svg", kind: "image", contentType: "image/svg+xml" },

    { path: "docs/guide.pdf", kind: "pdf", contentType: "application/pdf" },

    { path: "vendor/bundle.zip", kind: "binary", contentType: "application/zip" },
    { path: "fonts/body.woff2", kind: "binary", contentType: "font/woff2" },
    // Nothing recognises these, and `application/octet-stream` is the honest
    // answer rather than a guess.
    { path: "bin/tool", kind: "binary", contentType: "application/octet-stream" },
    { path: "data.weird", kind: "binary", contentType: "application/octet-stream" },
    // A dotfile has no extension to read: the leading dot is not a separator.
    { path: ".hidden", kind: "binary", contentType: "application/octet-stream" },
  ];

  for (const { path, kind, contentType } of cases) {
    it(`types ${path} as ${kind}`, () => {
      const media = artifactMediaType(path);
      expect(media.kind).toBe(kind);
      if (contentType) expect(media.contentType).toBe(contentType);
    });
  }

  it("reads the extension case-insensitively", () => {
    expect(artifactMediaType("A.MD")).toEqual(artifactMediaType("a.md"));
  });
});

/**
 * The rendered view of a file has to drop its frontmatter — handing a fence
 * to a markdown renderer turns `name: … description: …` into a paragraph of
 * prose above the real content.
 */
describe("Splitting frontmatter off a markdown file", () => {
  it("separates the fenced block from the body", () => {
    expect(splitFrontmatter("---\nname: a\ndescription: b\n---\n# Title\n")).toEqual({
      frontmatter: "name: a\ndescription: b",
      body: "# Title\n",
    });
  });

  it("leaves a file with no frontmatter entirely alone", () => {
    expect(splitFrontmatter("# Title\n\nProse.\n")).toEqual({ frontmatter: null, body: "# Title\n\nProse.\n" });
  });

  it("does not mistake a horizontal rule further down for a fence", () => {
    const source = "# Title\n\n---\n\nMore.\n";
    expect(splitFrontmatter(source)).toEqual({ frontmatter: null, body: source });
  });

  it("handles frontmatter with nothing after it", () => {
    expect(splitFrontmatter("---\nname: a\n---")).toEqual({ frontmatter: "name: a", body: "" });
  });

  it("tolerates a byte-order mark, which `parseSkillDocument` also strips", () => {
    expect(splitFrontmatter("\uFEFF---\nname: a\n---\nBody.\n")).toEqual({ frontmatter: "name: a", body: "Body.\n" });
  });
});
