import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { runPluginInstall, type PluginInstallDeps } from "../src/commands/plugins.js";
import { jsonResponse, stubFetch } from "./helpers.js";

const REGISTRY = "https://registry.example";
const encode = (text: string) => new TextEncoder().encode(text);

function plugin(agents: string[], namespace = "registry.example") {
  const now = new Date().toISOString();
  return {
    id: "8c0d6c1e-8f4b-4d8e-9a43-1c1f0f6e2a10",
    kind: "plugin",
    namespace,
    name: "review-suite",
    description: "Reviews code.",
    body: null,
    agents,
    version: "1.0.0",
    license: null,
    homepage: null,
    components: null,
    source: "com.example.registry",
    published_at: now,
    updated_at: now,
    published_by: { user_id: "u1", email: "writer@example.com", first_name: "A", last_name: "B" },
    tags: [],
    installs: 0,
  };
}

const ZIP = zipSync({
  ".claude-plugin/plugin.json": encode(JSON.stringify({ name: "review-suite" })),
  ".cursor-plugin/plugin.json": encode(JSON.stringify({ name: "review-suite" })),
  "commands/review.md": encode("Review."),
});

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "skillset-plugins-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

/** Deps whose Registry serves `served` and the zip, and whose agent CLIs succeed and are recorded. */
function depsFor(served: ReturnType<typeof plugin>, overrides: Partial<PluginInstallDeps> = {}) {
  const ran: string[] = [];
  const { fetch, calls } = stubFetch((url) => {
    if (url.startsWith(`${REGISTRY}/api/resources/plugin/by-name/review-suite`))
      return jsonResponse(200, served);
    if (url === `${REGISTRY}/api/resources/${served.id}/artifact?source=cli`)
      return new Response(ZIP);
    throw new Error(`Unexpected request to ${url}`);
  });
  const deps: PluginInstallDeps = {
    fetch,
    configPath: join(home, "config.json"),
    env: { SKILLSET_REGISTRY: REGISTRY },
    homeDir: home,
    isTTY: false,
    promptChoice: async () => {
      throw new Error("no prompt expected");
    },
    run: async (command, args) => {
      ran.push([command, ...args].join(" "));
      return { code: 0, output: "" };
    },
    ...overrides,
  };
  return { deps, calls, ran };
}

describe("runPluginInstall", () => {
  it("installs for the only agent a Plugin supports, through the Registry's hosted marketplace", async () => {
    const { deps, calls, ran } = depsFor(plugin(["claude-code"]));
    const result = await runPluginInstall(deps, { name: "review-suite" });

    expect(result).toMatchObject({
      name: "review-suite",
      agent: "claude-code",
      supported_agents: ["claude-code"],
    });
    expect(ran).toEqual([
      `claude plugin marketplace add ${REGISTRY}/.claude-plugin/marketplace.json`,
      "claude plugin install review-suite@skillset",
    ]);
    // Claude Code downloads the zip itself; the CLI does not.
    expect(calls.some((call) => call.url.includes("/artifact"))).toBe(false);
  });

  it("names an Imported Plugin's marketplace entry by its Namespace too", async () => {
    const { deps, ran } = depsFor(plugin(["claude-code"], "acme/plugins"));
    await runPluginInstall(deps, { name: "review-suite", namespace: "acme/plugins" });
    expect(ran.at(-1)).toBe("claude plugin install review-suite--acme-plugins@skillset");
  });

  it("downloads and copies the Plugin for Cursor", async () => {
    const { deps, ran } = depsFor(plugin(["claude-code", "cursor"]));
    const result = await runPluginInstall(deps, { name: "review-suite", agent: "cursor" });

    expect(result.path).toBe(join(home, ".cursor", "plugins", "local", "review-suite"));
    expect(
      await Bun.file(
        join(home, ".cursor", "plugins", "local", "review-suite", "commands", "review.md"),
      ).text(),
    ).toBe("Review.");
    expect(ran).toEqual([]);
  });

  it("refuses an agent the Plugin has no manifest for, naming the ones it has", async () => {
    const { deps } = depsFor(plugin(["claude-code", "cursor"]));
    await expect(runPluginInstall(deps, { name: "review-suite", agent: "codex" })).rejects.toThrow(
      /no Codex manifest\. It supports: claude-code \(Claude Code\), cursor \(Cursor\)/,
    );
  });

  it("refuses an unknown agent", async () => {
    const { deps } = depsFor(plugin(["claude-code"]));
    await expect(runPluginInstall(deps, { name: "review-suite", agent: "vim" })).rejects.toThrow(
      /Unknown agent "vim"/,
    );
  });

  it("needs --agent without a terminal when the Plugin supports several", async () => {
    const { deps } = depsFor(plugin(["claude-code", "cursor"]));
    await expect(runPluginInstall(deps, { name: "review-suite" })).rejects.toThrow(/Pass --agent/);
  });

  it("asks which agent at a terminal, offering only the ones the Plugin supports", async () => {
    let offered: readonly string[] = [];
    const { deps } = depsFor(plugin(["claude-code", "cursor"]), {
      isTTY: true,
      promptChoice: async (_question, choices) => {
        offered = choices;
        return "cursor";
      },
    });
    const result = await runPluginInstall(deps, { name: "review-suite" });
    expect(offered).toEqual(["claude-code", "cursor"]);
    expect(result.agent).toBe("cursor");
  });
});
