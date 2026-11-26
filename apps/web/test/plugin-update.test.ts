import { describe, expect, it } from "bun:test";
import type { SkillFile, SkillSourceLocation } from "@in-org-quicko/skillset-shared";
import { findPluginFiles } from "../src/lib/plugin-update";

const at = (path: string): SkillSourceLocation => ({
  provider: "github",
  project: "acme/plugins",
  ref: null,
  path,
});
const pluginNamed = (name: string): SkillFile[] => [
  {
    path: ".claude-plugin/plugin.json",
    bytes: new TextEncoder().encode(JSON.stringify({ name, description: "Does things." })),
  },
];

describe("findPluginFiles", () => {
  it("reads the folder named after the Plugin first", async () => {
    const read: string[] = [];
    const files = await findPluginFiles(
      [at("plugins/lint-kit"), at(""), at("plugins/review-suite")],
      async (location) => {
        read.push(location.path);
        return pluginNamed(location.path.split("/").at(-1) || "root");
      },
      "review-suite",
    );
    expect(read).toEqual(["plugins/review-suite"]);
    expect(files).toEqual(pluginNamed("review-suite"));
  });

  it("finds the Plugin by its manifest name when its folder is named otherwise", async () => {
    const files = await findPluginFiles(
      [at("a"), at("b")],
      async (location) => pluginNamed(location.path === "b" ? "review-suite" : "other"),
      "review-suite",
    );
    expect(files).toEqual(pluginNamed("review-suite"));
  });

  it("skips folders that fail to read", async () => {
    const files = await findPluginFiles(
      [at("broken"), at("ok")],
      async (location) => {
        if (location.path === "broken") throw new Error("404");
        return pluginNamed("review-suite");
      },
      "review-suite",
    );
    expect(files).toEqual(pluginNamed("review-suite"));
  });

  it("says so when no folder holds the Plugin", async () => {
    await expect(
      findPluginFiles([at("")], async () => pluginNamed("other"), "review-suite"),
    ).rejects.toThrow(/No plugin named "review-suite"/);
  });
});
