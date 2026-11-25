import { describe, expect, it } from "bun:test";
import { ancestorFolders, buildFileTree, type FolderNode } from "../src/lib/file-tree";

const file = (path: string) => ({ path, size: 1 });

/** The tree as indented lines, so a test reads like the panel looks. */
function outline(folder: FolderNode, depth = 0): string[] {
  const pad = "  ".repeat(depth);
  return [
    ...folder.files.map((f) => `${pad}${f.path.split("/").pop()}`),
    ...folder.folders.flatMap((child) => [`${pad}${child.name}/`, ...outline(child, depth + 1)]),
  ];
}

describe("buildFileTree", () => {
  it("nests each folder under its parent instead of one row per full path", () => {
    const tree = buildFileTree([
      file("README.md"),
      file("skills/api-patterns/SKILL.md"),
      file("skills/api-patterns/references/common/concepts.md"),
      file("skills/api-patterns/references/java/apis.md"),
      file(".claude-plugin/plugin.json"),
    ]);
    expect(outline(tree)).toEqual([
      "README.md",
      ".claude-plugin/",
      "  plugin.json",
      "skills/",
      "  api-patterns/",
      "    SKILL.md",
      "    references/",
      "      common/",
      "        concepts.md",
      "      java/",
      "        apis.md",
    ]);
  });

  it("keeps the API's file order inside a folder, so SKILL.md stays first", () => {
    const tree = buildFileTree([file("SKILL.md"), file("a.md")]);
    expect(tree.files.map((f) => f.path)).toEqual(["SKILL.md", "a.md"]);
  });
});

describe("ancestorFolders", () => {
  it("lists every folder above a file, outermost first", () => {
    expect(ancestorFolders("skills/a/references/x.md")).toEqual(["skills", "skills/a", "skills/a/references"]);
    expect(ancestorFolders("SKILL.md")).toEqual([]);
  });
});
