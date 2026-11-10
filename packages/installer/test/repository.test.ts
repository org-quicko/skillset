import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { walkSkillDirectory } from "../src/index.js";

describe("walkSkillDirectory", () => {
  it("returns the kept files in name order, whatever order the filesystem lists them in", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-walk-"));
    try {
      // Written out of order, so a filesystem that lists by creation would not happen to agree.
      for (const path of [
        "scripts/b.sh",
        "node_modules/left-pad/index.js",
        "scripts/a.sh",
        "references/java.md",
        "SKILL.md",
        "README.md",
      ]) {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), path);
      }

      const files = await walkSkillDirectory(root);

      expect(files.map((file) => file.path)).toEqual([
        "README.md",
        "SKILL.md",
        "references/java.md",
        "scripts/a.sh",
        "scripts/b.sh",
      ]);
      expect(new TextDecoder().decode(files[1]?.bytes)).toBe("SKILL.md");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
