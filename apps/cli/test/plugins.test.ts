import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import {
  runPluginInstall,
  runPluginUpdate,
  servesHostedMarketplace,
  type PluginInstallDeps,
} from "../src/commands/plugins.js";
import type { CommandResult } from "@in-org-quicko/skillset-installer";
import { jsonResponse, stubFetch } from "./helpers.js";

const HOSTED = "https://registry.example";
const LOCAL = "http://localhost:3000";
const encode = (text: string) => new TextEncoder().encode(text);

function plugin(agents: string[], options: { namespace?: string; updatedAt?: string } = {}) {
  const updated = options.updatedAt ?? "2026-11-01T00:00:00.000Z";
  return {
    id: "8c0d6c1e-8f4b-4d8e-9a43-1c1f0f6e2a10",
    kind: "plugin",
    namespace: options.namespace ?? "registry.example",
    name: "review-suite",
    description: "Reviews code.",
    body: null,
    agents,
    version: "1.0.0",
    license: null,
    homepage: null,
    components: null,
    source: "com.example.registry",
    published_at: updated,
    updated_at: updated,
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

/**
 * Deps whose Registry serves whatever `serve()` returns now, the zip, and a hosted
 * marketplace named `acme-plugins`; agent CLIs answer from `answer` and are recorded.
 */
function depsFor(
  serve: () => ReturnType<typeof plugin> | null,
  options: {
    registry?: string;
    answer?: (line: string) => CommandResult;
    overrides?: Partial<PluginInstallDeps>;
  } = {},
) {
  const registry = options.registry ?? HOSTED;
  const ran: string[] = [];
  const { fetch, calls } = stubFetch((url) => {
    if (url === `${registry}/.claude-plugin/marketplace.json`) return jsonResponse(200, { name: "acme-plugins" });
    if (url.startsWith(`${registry}/api/resources/plugin/by-name/review-suite`)) {
      const served = serve();
      return served ? jsonResponse(200, served) : jsonResponse(404, { error: { code: "not_found", message: "No." } });
    }
    if (url.endsWith("/artifact?source=cli")) return new Response(ZIP);
    throw new Error(`Unexpected request to ${url}`);
  });
  const deps: PluginInstallDeps = {
    fetch,
    configPath: join(home, "config", "config.json"),
    env: { SKILLSET_REGISTRY: registry },
    homeDir: home,
    isTTY: false,
    promptChoice: async () => {
      throw new Error("no prompt expected");
    },
    run: async (command, args) => {
      const line = [command, ...args].join(" ");
      ran.push(line);
      return options.answer?.(line) ?? { code: 0, output: "" };
    },
    ...options.overrides,
  };
  return { deps, calls, ran };
}

const records = async () =>
  JSON.parse(await readFile(join(home, "config", "plugins.json"), "utf8")) as { plugins: Record<string, unknown>[] };

describe("servesHostedMarketplace", () => {
  it("is true only for HTTPS on a public host", () => {
    expect(servesHostedMarketplace("https://skills.acme.com")).toBe(true);
    expect(servesHostedMarketplace("https://203.0.113.9")).toBe(true);
    for (const url of [
      "http://skills.acme.com",
      "https://localhost:3000",
      "https://127.0.0.1",
      "https://10.1.2.3",
      "https://172.20.0.1",
      "https://192.168.1.5",
      "https://169.254.169.254",
      "https://registry.local",
      "https://[::1]",
    ]) {
      expect(servesHostedMarketplace(url)).toBe(false);
    }
  });
});

describe("runPluginInstall", () => {
  it("installs for Claude Code from the hosted marketplace, by the name the Registry gives it", async () => {
    const { deps, calls, ran } = depsFor(() => plugin(["claude-code"]));
    const result = await runPluginInstall(deps, { name: "review-suite" });

    expect(result).toMatchObject({ name: "review-suite", agent: "claude-code", via: "hosted" });
    expect(ran).toEqual([
      `claude plugin marketplace add ${HOSTED}/.claude-plugin/marketplace.json`,
      "claude plugin install review-suite@acme-plugins",
    ]);
    // Claude Code downloads the zip itself; the CLI does not.
    expect(calls.some((call) => call.url.includes("/artifact"))).toBe(false);
  });

  it("names an Imported Plugin's marketplace entry by its Namespace too", async () => {
    const { deps, ran } = depsFor(() => plugin(["claude-code"], { namespace: "acme/plugins" }));
    await runPluginInstall(deps, { name: "review-suite", namespace: "acme/plugins" });
    expect(ran.at(-1)).toBe("claude plugin install review-suite--acme-plugins@acme-plugins");
  });

  it("installs for Claude Code from a local copy when the Registry is not public HTTPS", async () => {
    const { deps, ran } = depsFor(() => plugin(["claude-code"]), { registry: LOCAL });
    const result = await runPluginInstall(deps, { name: "review-suite" });

    const root = join(home, ".claude", "plugins", "local", "skillset");
    expect(result).toMatchObject({ via: "local", path: join(root, "review-suite") });
    expect(await readFile(join(root, "review-suite", "commands", "review.md"), "utf8")).toBe("Review.");
    expect(ran).toEqual([
      `claude plugin marketplace add ${root}`,
      "claude plugin install review-suite@skillset-local",
    ]);
  });

  it("downloads and copies the Plugin for Cursor, and remembers the install", async () => {
    const { deps, ran } = depsFor(() => plugin(["claude-code", "cursor"]));
    const result = await runPluginInstall(deps, { name: "review-suite", agent: "cursor" });

    expect(result.path).toBe(join(home, ".cursor", "plugins", "local", "review-suite"));
    expect(ran).toEqual([]);
    expect((await records()).plugins).toEqual([
      expect.objectContaining({
        registry: HOSTED,
        name: "review-suite",
        agent: "cursor",
        revision: `1.0.0+${Date.parse("2026-11-01T00:00:00.000Z") / 1000}`,
        via: null,
      }),
    ]);
  });

  it("updates rather than reinstalls a Plugin it already installed", async () => {
    const { deps, ran } = depsFor(() => plugin(["claude-code"]), { registry: LOCAL });
    await runPluginInstall(deps, { name: "review-suite" });
    ran.length = 0;
    await runPluginInstall(deps, { name: "review-suite" });

    expect(ran.at(-1)).toBe("claude plugin update review-suite@skillset-local");
    expect((await records()).plugins).toHaveLength(1);
  });

  it("refuses an agent the Plugin has no manifest for, naming the ones it has", async () => {
    const { deps } = depsFor(() => plugin(["claude-code", "cursor"]));
    await expect(runPluginInstall(deps, { name: "review-suite", agent: "codex" })).rejects.toThrow(
      /no Codex manifest\. It supports: claude-code \(Claude Code\), cursor \(Cursor\)/,
    );
  });

  it("refuses an unknown agent", async () => {
    const { deps } = depsFor(() => plugin(["claude-code"]));
    await expect(runPluginInstall(deps, { name: "review-suite", agent: "vim" })).rejects.toThrow(/Unknown agent "vim"/);
  });

  it("needs --agent without a terminal when the Plugin supports several", async () => {
    const { deps } = depsFor(() => plugin(["claude-code", "cursor"]));
    await expect(runPluginInstall(deps, { name: "review-suite" })).rejects.toThrow(/Pass --agent/);
  });

  it("asks which agent at a terminal, offering only the ones the Plugin supports", async () => {
    let offered: readonly string[] = [];
    const { deps } = depsFor(() => plugin(["claude-code", "cursor"]), {
      overrides: {
        isTTY: true,
        promptChoice: async (_question, choices) => {
          offered = choices;
          return "cursor";
        },
      },
    });
    const result = await runPluginInstall(deps, { name: "review-suite" });
    expect(offered).toEqual(["claude-code", "cursor"]);
    expect(result.agent).toBe("cursor");
  });
});

describe("runPluginUpdate", () => {
  it("leaves a Plugin the Registry has not republished alone", async () => {
    const { deps, ran } = depsFor(() => plugin(["cursor"]));
    await runPluginInstall(deps, { name: "review-suite" });
    const outcomes = await runPluginUpdate(deps, {});

    expect(outcomes).toEqual([
      expect.objectContaining({ name: "review-suite", agent: "cursor", status: "current" }),
    ]);
    expect(ran).toEqual([]);
  });

  it("reinstalls a Plugin republished since, and records the new revision", async () => {
    let updatedAt = "2026-11-01T00:00:00.000Z";
    const { deps, ran } = depsFor(() => plugin(["claude-code"], { updatedAt }));
    await runPluginInstall(deps, { name: "review-suite" });
    updatedAt = "2026-11-02T00:00:00.000Z";
    ran.length = 0;

    const outcomes = await runPluginUpdate(deps, { name: "review-suite" });

    const to = `1.0.0+${Date.parse(updatedAt) / 1000}`;
    expect(outcomes).toEqual([expect.objectContaining({ status: "updated", to })]);
    expect(ran).toEqual(["claude plugin marketplace update acme-plugins", "claude plugin update review-suite@acme-plugins"]);
    expect((await records()).plugins[0]).toMatchObject({ revision: to });
  });

  it("reinstalls with --force even when nothing changed", async () => {
    const { deps } = depsFor(() => plugin(["cursor"]));
    await runPluginInstall(deps, { name: "review-suite" });
    const [outcome] = await runPluginUpdate(deps, { force: true });
    expect(outcome?.status).toBe("updated");
  });

  it("reports a Plugin it cannot update and carries on", async () => {
    let served: ReturnType<typeof plugin> | null = plugin(["cursor"]);
    const { deps } = depsFor(() => served);
    await runPluginInstall(deps, { name: "review-suite" });
    served = null;

    const outcomes = await runPluginUpdate(deps, {});
    expect(outcomes).toEqual([expect.objectContaining({ status: "failed" })]);
  });

  it("refuses to update a Plugin the CLI never installed", async () => {
    const { deps } = depsFor(() => plugin(["cursor"]));
    await expect(runPluginUpdate(deps, { name: "review-suite" })).rejects.toThrow(/was not installed with/);
  });
});
