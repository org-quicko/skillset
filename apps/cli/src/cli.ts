#!/usr/bin/env node
import { Command } from "commander";
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
