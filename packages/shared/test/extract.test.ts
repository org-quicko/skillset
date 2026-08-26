import { describe, expect, it } from "bun:test";
import { zipSync, type Zippable } from "fflate";
import {
  ARTIFACT_MAX_ENTRIES,
  ARTIFACT_MAX_UNCOMPRESSED_BYTES,
  planExtraction,
  SkillValidationError,
  type SkillRule,
} from "../src/index.js";

const encoder = new TextEncoder();

function zip(entries: Zippable): Uint8Array {
  return zipSync(entries);
}

function validSkillZip(extra: Zippable = {}): Uint8Array {
  return zip({ "SKILL.md": encoder.encode("---\nname: code-review\ndescription: Reviews code.\n---\nBody.\n"), ...extra });
}

/** The rule a zip breaks, or that it breaks none — one assertion shape for every case below. */
function ruleFor(zipBytes: Uint8Array): SkillRule | "no error" {
  try {
    planExtraction(zipBytes);
    return "no error";
  } catch (error) {
    if (error instanceof SkillValidationError) return error.rule;
    throw error;
  }
}

/**
 * Seam — the extraction-safety pipeline (the only place a hostile Artifact is inspected
 * at all, since the API never does — ADR-0001; docs/adr/0014).
 */
describe("planExtraction", () => {
  it("extracts a valid archive", () => {
    const files = planExtraction(validSkillZip());
    expect(files.map((f) => f.path)).toEqual(["SKILL.md"]);
  });

  it("drops directory-marker entries", () => {
    const files = planExtraction(validSkillZip({ "references/": new Uint8Array(0) }));
    expect(files.map((f) => f.path)).toEqual(["SKILL.md"]);
  });

  it("keeps ordinary supporting files", () => {
    const files = planExtraction(validSkillZip({ "scripts/run.sh": encoder.encode("echo hi") }));
    expect(files.map((f) => f.path).sort()).toEqual(["SKILL.md", "scripts/run.sh"]);
  });

  const nameCases: Array<{ name: string; entryName: string; expected: SkillRule }> = [
    { name: "a parent-directory segment", entryName: "../evil.txt", expected: "entry_path_traversal" },
    { name: "a parent-directory segment mid-path", entryName: "references/../../evil.txt", expected: "entry_path_traversal" },
    { name: "a leading slash", entryName: "/evil.txt", expected: "entry_absolute_path" },
    { name: "a drive letter", entryName: "C:/evil.txt", expected: "entry_absolute_path" },
    { name: "a null byte", entryName: "evil\0.txt", expected: "entry_null_byte" },
  ];

  for (const { name, entryName, expected } of nameCases) {
    it(`rejects ${name}`, () => {
      expect(ruleFor(validSkillZip({ [entryName]: encoder.encode("junk") }))).toBe(expected);
    });
  }

  it("rejects a symlink entry", () => {
    const bytes = zipSync({
      "SKILL.md": encoder.encode("---\nname: code-review\ndescription: Reviews code.\n---\nBody.\n"),
      "evil-link": [encoder.encode("../../etc/passwd"), { os: 3, attrs: 0o120777 << 16 }],
    });
    expect(ruleFor(bytes)).toBe("entry_symlink");
  });

  it("does not flag an ordinary Unix-permissioned file as a symlink", () => {
    const bytes = zipSync({
      "SKILL.md": encoder.encode("---\nname: code-review\ndescription: Reviews code.\n---\nBody.\n"),
      "scripts/run.sh": [encoder.encode("echo hi"), { os: 3, attrs: 0o100755 << 16 }],
    });
    expect(ruleFor(bytes)).toBe("no error");
  });

  it("rejects garbage that isn't a zip archive at all", () => {
    expect(ruleFor(encoder.encode("not a zip file"))).toBe("corrupt_archive");
  });

  it(`rejects more than ${ARTIFACT_MAX_ENTRIES} entries`, () => {
    const extra: Zippable = {};
    for (let i = 0; i < ARTIFACT_MAX_ENTRIES; i++) extra[`references/note-${i}.md`] = encoder.encode("note");
    expect(ruleFor(validSkillZip(extra))).toBe("too_many_entries");
  });

  it("accepts exactly the entry limit", () => {
    const extra: Zippable = {};
    for (let i = 0; i < ARTIFACT_MAX_ENTRIES - 1; i++) extra[`references/note-${i}.md`] = encoder.encode("note");
    expect(ruleFor(validSkillZip(extra))).toBe("no error");
  });

  it("rejects files coming to more than the uncompressed limit", () => {
    expect(ruleFor(validSkillZip({ "references/big.bin": new Uint8Array(ARTIFACT_MAX_UNCOMPRESSED_BYTES + 1) }))).toBe(
      "uncompressed_too_large",
    );
  });

  it("tolerates a single wrapping directory", () => {
    const files = planExtraction(
      zip({
        "code-review/SKILL.md": encoder.encode("---\nname: code-review\ndescription: Reviews code.\n---\nBody.\n"),
        "code-review/scripts/run.sh": encoder.encode("echo hi"),
      }),
    );
    expect(files.map((f) => f.path).sort()).toEqual(["SKILL.md", "scripts/run.sh"]);
  });

  it("rejects an ambiguous layout with several candidate Skills", () => {
    expect(
      ruleFor(
        zip({
          "one/SKILL.md": encoder.encode("---\nname: one\ndescription: One.\n---\nBody.\n"),
          "two/SKILL.md": encoder.encode("---\nname: two\ndescription: Two.\n---\nBody.\n"),
        }),
      ),
    ).toBe("ambiguous_layout");
  });

  it("rejects an archive with no SKILL.md", () => {
    expect(ruleFor(zip({ "readme.txt": encoder.encode("hello") }))).toBe("skill_md_missing");
  });
});
