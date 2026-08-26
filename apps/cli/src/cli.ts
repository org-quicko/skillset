#!/usr/bin/env node
import { Command } from "commander";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { runAdd } from "./commands/add.js";
import { runLogin } from "./commands/login.js";
import { runPublish } from "./commands/publish.js";
import { runWhoami } from "./commands/whoami.js";
import { resolveConfigPath } from "./config.js";

const program = new Command();
program.name("skillreg").description("Publish and manage Skills on a Skill Registry.");

program
  .command("login")
  .description("Authenticate the CLI against a Registry with a Token minted from the web interface.")
  .requiredOption("--registry <url>", "The Registry's URL")
  .requiredOption("--token <secret>", "A Token minted from the web interface")
  .action(async (opts: { registry: string; token: string }) => {
    await handle(async () => {
      const result = await runLogin({ fetch, configPath: resolveConfigPath(process.env) }, opts);
      console.log(`Logged in to ${result.registry} as ${result.email} (${result.role}).`);
    });
  });

program
  .command("whoami")
  .description("Show which Registry the CLI is authenticated against and as whom.")
  .action(async () => {
    await handle(async () => {
      const result = await runWhoami({ fetch, configPath: resolveConfigPath(process.env), env: process.env });
      console.log(`${result.registry} — ${result.email} (${result.role})`);
    });
  });

program
  .command("publish")
  .description("Publish the Skill at [path] (defaults to the current directory).")
  .argument("[path]", "Path to the Skill's directory")
  .action(async (path: string | undefined) => {
    await handle(async () => {
      const result = await runPublish(
        { fetch, configPath: resolveConfigPath(process.env), env: process.env, cwd: process.cwd() },
        { path },
      );
      console.log(`Published ${result.name} (${result.id}) at ${result.published_at}.`);
    });
  });

program
  .command("add")
  .description("Download and install a Skill for one or more Agents.")
  .argument("<name>", "The Skill's name")
  .option("--agent <ids...>", "Agent(s) to install for (claude-code, codex, generic)")
  .option("--scope <scope>", "Install scope: project or user")
  .action(async (name: string, opts: { agent?: string[]; scope?: string }) => {
    await handle(async () => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const reports = await runAdd(
          {
            fetch,
            configPath: resolveConfigPath(process.env),
            env: process.env,
            cwd: process.cwd(),
            homeDir: homedir(),
            isTTY: process.stdin.isTTY === true,
            write: (text) => process.stdout.write(text),
            readLine: () => rl.question(""),
          },
          { name, agent: opts.agent, scope: opts.scope },
        );
        for (const report of reports) {
          const modeLabel = report.mode === "canonical" ? "written" : report.mode === "symlink" ? "symlinked" : "copied";
          const suffix = report.agents.length > 1 ? ` (serves: ${report.agents.join(", ")})` : "";
          console.log(`${modeLabel} ${report.directory}${suffix}`);
        }
      } finally {
        rl.close();
      }
    });
  });

/** Every command's action funnels through here: a thrown Error becomes a one-line message and exit code 1, never a stack trace. */
async function handle(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

await program.parseAsync(process.argv);
