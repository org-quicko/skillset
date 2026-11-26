import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SkillFile } from "@in-org-quicko/skillset-shared";
import {
  installClaudeCodePluginHosted,
  installClaudeCodePluginLocally,
  installCodexPlugin,
  installCursorPlugin,
  type CommandResult,
  type PluginInstallContext,
} from "../src/plugin-install.js";

const encode = (text: string) => new TextEncoder().encode(text);
const file = (path: string, text: string): SkillFile => ({ path, bytes: encode(text) });
const manifest = (folder: string) =>
  file(`${folder}/plugin.json`, JSON.stringify({ name: "review-suite" }));

/** A context whose agent CLIs answer from `answer`, recording every call. */
function contextFor(
  homeDir: string,
  answer: (line: string) => CommandResult = () => ({ code: 0, output: "" }),
) {
  const calls: string[] = [];
  const context: PluginInstallContext = {
    homeDir,
    run: async (command, args) => {
      const line = [command, ...args].join(" ");
      calls.push(line);
      return answer(line);
    },
  };
  return { context, calls };
}

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "skillset-plugin-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const HOSTED = {
  marketplaceUrl: "https://skills.acme.com/.claude-plugin/marketplace.json",
  marketplaceName: "skillset",
  entry: "review-suite",
};

describe("installClaudeCodePluginHosted", () => {
  it("adds the Registry's hosted marketplace, then installs the entry from it", async () => {
    const { context, calls } = contextFor(home);
    const report = await installClaudeCodePluginHosted(context, HOSTED, "install");
    expect(calls).toEqual([
      "claude plugin marketplace add https://skills.acme.com/.claude-plugin/marketplace.json",
      "claude plugin install review-suite@skillset",
    ]);
    expect(report).toMatchObject({ agent: "claude-code", path: null });
  });

  it("refreshes the marketplace when it is already added", async () => {
    const { context, calls } = contextFor(home, (line) =>
      line.includes("marketplace add") ? { code: 1, output: "already exists" } : { code: 0, output: "" },
    );
    await installClaudeCodePluginHosted(context, HOSTED, "install");
    expect(calls.slice(1)).toEqual([
      "claude plugin marketplace update skillset",
      "claude plugin install review-suite@skillset",
    ]);
  });

  it("refreshes the marketplace and updates the plugin on update", async () => {
    const { context, calls } = contextFor(home);
    await installClaudeCodePluginHosted(context, { ...HOSTED, marketplaceName: "acme" }, "update");
    expect(calls).toEqual(["claude plugin marketplace update acme", "claude plugin update review-suite@acme"]);
  });

  it("says so when claude is not on PATH", async () => {
    const { context } = contextFor(home, () => ({ code: null, output: "" }));
    await expect(installClaudeCodePluginHosted(context, HOSTED, "install")).rejects.toThrow(
      /Claude Code's `claude` CLI is not on PATH/,
    );
  });

  it("reports the install's own output when it fails", async () => {
    const { context } = contextFor(home, (line) =>
      line.includes("plugin install") ? { code: 1, output: "plugin not found" } : { code: 0, output: "" },
    );
    await expect(installClaudeCodePluginHosted(context, HOSTED, "install")).rejects.toThrow(/plugin not found/);
  });
});

describe("installClaudeCodePluginLocally", () => {
  const root = () => join(home, ".claude", "plugins", "local", "skillset");

  it("writes the plugin beside a local marketplace that lists it, then installs from it", async () => {
    const { context, calls } = contextFor(home);
    const report = await installClaudeCodePluginLocally(
      context,
      "review-suite",
      [manifest(".claude-plugin"), file("commands/review.md", "Review.")],
      "1.2.0+100",
      "install",
    );

    expect(report.path).toBe(join(root(), "review-suite"));
    expect(await readFile(join(root(), "review-suite", "commands", "review.md"), "utf8")).toBe("Review.");
    const marketplace = JSON.parse(await readFile(join(root(), ".claude-plugin", "marketplace.json"), "utf8"));
    expect(marketplace).toEqual({
      name: "skillset-local",
      owner: { name: "Skillset" },
      plugins: [{ name: "review-suite", source: "./review-suite", version: "1.2.0+100" }],
    });
    expect(calls).toEqual([`claude plugin marketplace add ${root()}`, "claude plugin install review-suite@skillset-local"]);
  });

  it("updates in place: a new revision in the marketplace, a refresh, then claude plugin update", async () => {
    const { context, calls } = contextFor(home, (line) =>
      line.includes("marketplace add") ? { code: 1, output: "already added" } : { code: 0, output: "" },
    );
    await installClaudeCodePluginLocally(context, "lint-kit", [manifest(".claude-plugin")], "0.1.0+1", "install");
    await installClaudeCodePluginLocally(context, "review-suite", [manifest(".claude-plugin")], "1.2.0+100", "install");
    calls.length = 0;
    await installClaudeCodePluginLocally(context, "review-suite", [manifest(".claude-plugin")], "1.2.0+200", "update");

    const marketplace = JSON.parse(await readFile(join(root(), ".claude-plugin", "marketplace.json"), "utf8"));
    expect(marketplace.plugins).toEqual([
      { name: "lint-kit", source: "./lint-kit", version: "0.1.0+1" },
      { name: "review-suite", source: "./review-suite", version: "1.2.0+200" },
    ]);
    expect(calls).toEqual([
      `claude plugin marketplace add ${root()}`,
      "claude plugin marketplace update skillset-local",
      "claude plugin update review-suite@skillset-local",
    ]);
  });

  it("refuses a Plugin with no Claude Code manifest", async () => {
    const { context } = contextFor(home);
    await expect(
      installClaudeCodePluginLocally(context, "review-suite", [manifest(".cursor-plugin")], "1.0.0", "install"),
    ).rejects.toThrow(/no \.claude-plugin\/plugin\.json/);
  });
});

describe("installCursorPlugin", () => {
  it("replaces the plugin's folder under ~/.cursor/plugins/local with exactly its files", async () => {
    const dir = join(home, ".cursor", "plugins", "local", "review-suite");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "stale.md"), "gone");
    const { context, calls } = contextFor(home);

    const report = await installCursorPlugin(context, "review-suite", [
      manifest(".cursor-plugin"),
      file("rules/style.mdc", "Be terse."),
    ]);

    expect(report.path).toBe(dir);
    expect(await readFile(join(dir, "rules", "style.mdc"), "utf8")).toBe("Be terse.");
    expect(await Bun.file(join(dir, "stale.md")).exists()).toBe(false);
    expect(calls).toEqual([]);
  });

  it("refuses a Plugin with no Cursor manifest", async () => {
    const { context } = contextFor(home);
    await expect(
      installCursorPlugin(context, "review-suite", [manifest(".claude-plugin")]),
    ).rejects.toThrow(/no \.cursor-plugin\/plugin\.json/);
  });
});

describe("installCodexPlugin", () => {
  it("writes the plugin beside a local marketplace that lists it, then adds both to Codex", async () => {
    const { context, calls } = contextFor(home);
    const root = join(home, ".agents", "plugins", "local", "skillset");

    const report = await installCodexPlugin(context, "review-suite", [manifest(".codex-plugin")]);

    expect(report.path).toBe(join(root, "review-suite"));
    expect(
      await Bun.file(join(root, "review-suite", ".codex-plugin", "plugin.json")).exists(),
    ).toBe(true);
    const marketplace = JSON.parse(
      await readFile(join(root, ".agents", "plugins", "marketplace.json"), "utf8"),
    );
    expect(marketplace.name).toBe("skillset");
    expect(marketplace.plugins).toEqual([
      {
        name: "review-suite",
        source: { source: "local", path: "./review-suite" },
        policy: { installation: "AVAILABLE" },
        category: "Productivity",
      },
    ]);
    expect(calls).toEqual([
      `codex plugin marketplace add ${root}`,
      "codex plugin add review-suite@skillset",
    ]);
  });

  it("keeps the marketplace's other plugins, and installs even when the marketplace is already added", async () => {
    const { context } = contextFor(home, (line) =>
      line.includes("marketplace add")
        ? { code: 1, output: "already added" }
        : { code: 0, output: "" },
    );
    await installCodexPlugin(context, "lint-kit", [manifest(".codex-plugin")]);
    await installCodexPlugin(context, "review-suite", [manifest(".codex-plugin")]);
    await installCodexPlugin(context, "review-suite", [manifest(".codex-plugin")]);

    const path = join(
      home,
      ".agents",
      "plugins",
      "local",
      "skillset",
      ".agents",
      "plugins",
      "marketplace.json",
    );
    const marketplace = JSON.parse(await readFile(path, "utf8"));
    expect(marketplace.plugins.map((plugin: { name: string }) => plugin.name)).toEqual([
      "lint-kit",
      "review-suite",
    ]);
  });

  it("says so when codex is not on PATH", async () => {
    const { context } = contextFor(home, () => ({ code: null, output: "" }));
    await expect(
      installCodexPlugin(context, "review-suite", [manifest(".codex-plugin")]),
    ).rejects.toThrow(/Codex's `codex` CLI is not on PATH/);
  });
});
