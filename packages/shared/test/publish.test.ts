import { describe, expect, it } from "bun:test";
import {
  ARTIFACT_MAX_ENTRIES,
  ARTIFACT_MAX_UNCOMPRESSED_BYTES,
  buildSkillBundle,
  SkillValidationError,
  type SkillBundle,
  type SkillFile,
  type SkillRule,
} from "../src/index.js";

const encoder = new TextEncoder();

function file(path: string, contents: string): SkillFile {
  return { path, bytes: encoder.encode(contents) };
}

function skillMd(frontmatter: string, body = "How to do the thing.\n"): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

function validSkill(extra: SkillFile[] = []): SkillFile[] {
  return [file("SKILL.md", skillMd("name: code-review\ndescription: Reviews code.")), ...extra];
}

/** The rule a set of files breaks, or that it breaks none — one assertion shape for every case below. */
function ruleFor(files: SkillFile[]): SkillRule | "no error" {
  try {
    buildSkillBundle(files);
    return "no error";
  } catch (error) {
    if (error instanceof SkillValidationError) return error.rule;
    throw error;
  }
}

/**
 * The paths a bundle would upload. Read off the declared manifest rather than
 * the files array so it also asserts that the two agree — they are what the
 * publish response's upload targets are paired against, index for index.
 */
function entryNames(bundle: SkillBundle): string[] {
  expect(bundle.files.map((file) => file.path)).toEqual(bundle.request.files.map((file) => file.path));
  return bundle.request.files.map((file) => file.path).sort();
}

/**
 * Seam 2 — the shared publishing pipeline (spec, "Testing Decisions"): pure
 * functions, files in and validated metadata plus the Artifact's files out.
 * The API validates the manifest those files are declared as (ADR-0032) but
 * still never reads their bytes (ADR-0001), so this is the only place the
 * structural rules are covered against real files.
 */
describe("Skill validation (ticket 03)", () => {
  const nameCases: Array<{ name: string; expected: SkillRule | "no error" }> = [
    { name: "code-review", expected: "no error" },
    { name: "a", expected: "no error" },
    { name: "skill-2", expected: "no error" },
    { name: "a".repeat(64), expected: "no error" },
    { name: "a".repeat(65), expected: "name_too_long" },
    { name: "", expected: "name_required" },
    { name: "Code-Review", expected: "name_invalid" },
    { name: "code_review", expected: "name_invalid" },
    { name: "-code-review", expected: "name_invalid" },
    { name: "code-review-", expected: "name_invalid" },
    { name: "code--review", expected: "name_invalid" },
    { name: "code review", expected: "name_invalid" },
    { name: "code/review", expected: "name_invalid" },
  ];

  for (const { name, expected } of nameCases) {
    it(`a name of "${name}" is ${expected === "no error" ? "accepted" : `rejected as ${expected}`}`, () => {
      const files = [file("SKILL.md", skillMd(`name: "${name}"\ndescription: Reviews code.`))];
      expect(ruleFor(files)).toBe(expected);
    });
  }

  const descriptionCases: Array<{ label: string; description: string; expected: SkillRule | "no error" }> = [
    { label: "a normal description", description: "Reviews code.", expected: "no error" },
    { label: "a description of exactly 1024 characters", description: "d".repeat(1024), expected: "no error" },
    { label: "a description of 1025 characters", description: "d".repeat(1025), expected: "description_too_long" },
    { label: "an empty description", description: '""', expected: "description_required" },
  ];

  for (const { label, description, expected } of descriptionCases) {
    it(`${label} is ${expected === "no error" ? "accepted" : `rejected as ${expected}`}`, () => {
      const files = [file("SKILL.md", skillMd(`name: code-review\ndescription: ${description}`))];
      expect(ruleFor(files)).toBe(expected);
    });
  }

  it("rejects a Skill with no description key at all", () => {
    expect(ruleFor([file("SKILL.md", skillMd("name: code-review"))])).toBe("description_required");
  });

  it("rejects a Skill with no SKILL.md at its root", () => {
    expect(ruleFor([file("README.md", "# Not a Skill")])).toBe("skill_md_missing");
  });

  it("rejects a SKILL.md with no frontmatter", () => {
    expect(ruleFor([file("SKILL.md", "# Just a heading\n")])).toBe("frontmatter_missing");
  });

  it("rejects frontmatter that is not a YAML mapping", () => {
    expect(ruleFor([file("SKILL.md", "---\n- code-review\n---\nBody\n")])).toBe("frontmatter_invalid");
  });

  it("names the field that broke the rule, so a caller can report it", () => {
    const files = [file("SKILL.md", skillMd("name: Code_Review\ndescription: Reviews code."))];
    expect(() => buildSkillBundle(files)).toThrow(SkillValidationError);
    try {
      buildSkillBundle(files);
    } catch (error) {
      expect((error as SkillValidationError).field).toBe("name");
    }
  });
});

describe("Artifact layout (ticket 03)", () => {
  it("archives the Skill's contents at the Artifact's root", () => {
    const bundle = buildSkillBundle(validSkill([file("references/style.md", "Style guide")]));
    expect(entryNames(bundle)).toEqual(["SKILL.md", "references/style.md"]);
  });

  it("strips a single wrapping directory rather than archiving it", () => {
    const bundle = buildSkillBundle([
      file("code-review/SKILL.md", skillMd("name: code-review\ndescription: Reviews code.")),
      file("code-review/references/style.md", "Style guide"),
    ]);
    expect(entryNames(bundle)).toEqual(["SKILL.md", "references/style.md"]);
  });

  it("rejects a layout holding several Skills rather than guessing which one to publish", () => {
    const files = [
      file("code-review/SKILL.md", skillMd("name: code-review\ndescription: Reviews code.")),
      file("write-docs/SKILL.md", skillMd("name: write-docs\ndescription: Writes docs.")),
    ];
    expect(ruleFor(files)).toBe("ambiguous_layout");
  });

  it("parses name and description from frontmatter and keeps the body below it", () => {
    const bundle = buildSkillBundle([
      file("SKILL.md", skillMd("name: code-review\ndescription: Reviews code.", "# Review\n\nSteps here.\n")),
    ]);
    expect(bundle.name).toBe("code-review");
    expect(bundle.request.description).toBe("Reviews code.");
    expect(bundle.request.body).toBe("# Review\n\nSteps here.\n");
  });

  it("carries every frontmatter field the SKILL.md set into the request body", () => {
    const bundle = buildSkillBundle([
      file(
        "SKILL.md",
        skillMd(
          [
            "name: code-review",
            "description: Reviews code.",
            "license: MIT",
            "compatibility: Claude Code",
            "allowed-tools: Read, Grep",
            "metadata:",
            "  team: platform",
          ].join("\n"),
        ),
      ),
    ]);

    // The body both publishers now send verbatim. Asserted whole rather than
    // field by field: a field that stopped reaching the wire is exactly the
    // regression the hand-written literals used to allow, and only an
    // exhaustive comparison catches it.
    expect(bundle.request).toEqual({
      description: "Reviews code.",
      body: "How to do the thing.\n",
      license: "MIT",
      compatibility: "Claude Code",
      allowed_tools: "Read, Grep",
      metadata: { team: "platform" },
      files: [{ path: "SKILL.md", size: bundle.files[0]!.bytes.byteLength }],
    });
  });

  it("omits a frontmatter field the SKILL.md never set, rather than sending it null", () => {
    const bundle = buildSkillBundle(validSkill());

    // `name` is the path segment, so repeating it in the body would give one
    // value two homes; the four optional fields are simply absent. `files` is
    // always there — an Artifact with no manifest could not be uploaded.
    expect(Object.keys(bundle.request).sort()).toEqual(["body", "description", "files"]);
    expect("name" in bundle.request).toBe(false);
  });
});

describe("Artifact exclusions and limits (ticket 03)", () => {
  const excluded = [
    ".git/config",
    ".git/objects/ab/cdef",
    "node_modules/left-pad/index.js",
    ".venv/lib/python3/site.py",
    ".DS_Store",
    "references/.DS_Store",
    "Thumbs.db",
    "SKILL.md~",
    ".vscode/settings.json",
    "__pycache__/thing.pyc",
  ];

  for (const path of excluded) {
    it(`excludes ${path} from the Artifact`, () => {
      const bundle = buildSkillBundle(validSkill([file(path, "junk")]));
      expect(entryNames(bundle)).toEqual(["SKILL.md"]);
    });
  }

  it("keeps ordinary supporting files", () => {
    const bundle = buildSkillBundle(
      validSkill([file("references/style.md", "Style"), file("scripts/run.sh", "echo hi")]),
    );
    expect(entryNames(bundle)).toEqual(["SKILL.md", "references/style.md", "scripts/run.sh"]);
  });

  it(`rejects more than ${ARTIFACT_MAX_ENTRIES} entries`, () => {
    const extra = Array.from({ length: ARTIFACT_MAX_ENTRIES }, (_, index) =>
      file(`references/note-${index}.md`, "note"),
    );
    expect(ruleFor(validSkill(extra))).toBe("too_many_entries");
  });

  it("accepts exactly the entry limit", () => {
    const extra = Array.from({ length: ARTIFACT_MAX_ENTRIES - 1 }, (_, index) =>
      file(`references/note-${index}.md`, "note"),
    );
    expect(ruleFor(validSkill(extra))).toBe("no error");
  });

  it("rejects files coming to more than the uncompressed limit", () => {
    const oversized: SkillFile = {
      path: "references/big.bin",
      bytes: new Uint8Array(ARTIFACT_MAX_UNCOMPRESSED_BYTES + 1),
    };
    expect(ruleFor(validSkill([oversized]))).toBe("uncompressed_too_large");
  });

  it("counts the entry limit after exclusions, not before", () => {
    const ignored = Array.from({ length: ARTIFACT_MAX_ENTRIES }, (_, index) =>
      file(`node_modules/pkg-${index}/index.js`, "module.exports = 1"),
    );
    expect(ruleFor(validSkill(ignored))).toBe("no error");
  });
});
