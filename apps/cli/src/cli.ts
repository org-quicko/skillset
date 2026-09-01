#!/usr/bin/env node
import * as p from "@clack/prompts";
import { Command } from "commander";
import { homedir } from "node:os";
import pc from "picocolors";
import { runAdd } from "./commands/add.js";
import { runLogin } from "./commands/login.js";
import { runPublish } from "./commands/publish.js";
import { runWhoami } from "./commands/whoami.js";
import { resolveConfigPath } from "./config.js";
import { bannerText, fail, promptAgent, promptChoice } from "./ui.js";

const program = new Command();
program.name("skillreg").description("Publish and manage Skills on a Skill Registry.");
program.addHelpText("beforeAll", bannerText());
program.action(() => console.log(bannerText()));

const label = (verb: string) => pc.bgCyan(pc.black(` skillreg ${verb} `));

program
  .command("login")
  .description("Authenticate the CLI against a Registry with a Token minted from the web interface.")
  .requiredOption("--registry <url>", "The Registry's URL")
  .requiredOption("--token <secret>", "A Token minted from the web interface")
  .action(async (opts: { registry: string; token: string }) => {
    p.intro(label("login"));
    const s = p.spinner();
    s.start(`Verifying your Token against ${opts.registry}`);
    try {
      const result = await runLogin({ fetch, configPath: resolveConfigPath(process.env) }, opts);
      s.stop(`Authenticated as ${pc.cyan(result.email)} ${pc.dim(`(${result.role})`)}`);
      p.outro(`Logged in to ${result.registry}`);
    } catch (error) {
      s.error(pc.red("Login failed"));
      fail(error);
    }
  });

program
  .command("whoami")
  .description("Show which Registry the CLI is authenticated against and as whom.")
  .action(async () => {
    p.intro(label("whoami"));
    const s = p.spinner();
    s.start("Resolving identity");
    try {
      const result = await runWhoami({ fetch, configPath: resolveConfigPath(process.env), env: process.env });
      s.stop(`${pc.cyan(result.email)} ${pc.dim(`(${result.role})`)}`);
      p.outro(result.registry);
    } catch (error) {
      s.error(pc.red("Could not resolve identity"));
      fail(error);
    }
  });

program
  .command("publish")
  .description("Publish the Skill at [path] (defaults to the current directory).")
  .argument("[path]", "Path to the Skill's directory")
  .action(async (path: string | undefined) => {
    p.intro(label("publish"));
    const s = p.spinner();
    s.start("Validating and uploading the Skill");
    try {
      const result = await runPublish(
        { fetch, configPath: resolveConfigPath(process.env), env: process.env, cwd: process.cwd() },
        { path },
      );
      s.stop(`Published ${pc.cyan(result.name)}`);
      p.outro(pc.dim(`${result.id} · ${result.published_at}`));
    } catch (error) {
      s.error(pc.red("Publish failed"));
      fail(error);
    }
  });

program
  .command("add")
  .description("Download and install a Skill for a coding Agent.")
  .argument("<name>", "The Skill's name")
  .option("--agent <id>", "Agent to install for (run with no value to pick from the list)")
  .option("--scope <scope>", "Install scope: project or user")
  .option("--copy", "Copy the Skill into the Agent's own directory instead of symlinking to .agents/skills")
  .action(async (name: string, opts: { agent?: string; scope?: string; copy?: boolean }) => {
    p.intro(label("add"));
    try {
      const report = await runAdd(
        {
          fetch,
          configPath: resolveConfigPath(process.env),
          env: process.env,
          cwd: process.cwd(),
          homeDir: homedir(),
          isTTY: process.stdin.isTTY === true,
          promptChoice,
          promptAgent,
        },
        { name, agent: opts.agent, scope: opts.scope, copy: opts.copy },
      );
      p.log.success(`Installed ${pc.cyan(report.skillDirectory)}`);
      if (report.link.kind === "symlink") {
        p.log.message(pc.dim(`${report.agent}: symlinked ${report.link.path}`));
      } else if (report.link.kind === "copy") {
        const why = report.link.reason === "symlink-failed" ? " (symlink unavailable on this system)" : "";
        p.log.message(pc.dim(`${report.agent}: copied into ${report.link.path}${why}`));
      } else {
        p.log.message(pc.dim(`${report.agent} reads .agents/skills directly`));
      }
      p.outro("Done");
    } catch (error) {
      fail(error);
    }
  });

await program.parseAsync(process.argv);
