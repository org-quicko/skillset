#!/usr/bin/env node
import * as p from "@clack/prompts";
import { getAgent } from "@skillset/shared";
import { Command } from "commander";
import { homedir } from "node:os";
import pc from "picocolors";
import { runAdd } from "./commands/add.js";
import { runLogin } from "./commands/login.js";
import { runPublish } from "./commands/publish.js";
import { runWhoami } from "./commands/whoami.js";
import { resolveConfigPath } from "./config.js";
import { bannerText, fail, promptAgent, promptChoice, promptConfirm, promptToken } from "./ui.js";

const program = new Command();
program.name("skillset").description("Publish and manage Skills on Skillset.");
program.addHelpText("beforeAll", bannerText());
program.action(() => console.log(bannerText()));

const label = (verb: string) => pc.bgCyan(pc.black(` skillset ${verb} `));

program
  .command("login")
  .description("Authenticate the CLI against a Registry with a Token minted from the web interface.")
  .requiredOption("--registry <url>", "The Registry's URL")
  .option("--token <secret>", "A Token minted from the web interface (prompted for if omitted)")
  .action(async (opts: { registry: string; token?: string }) => {
    p.intro(label("login"));

    // Prompted rather than required on the command line, so the Token stays out of shell
    // history and the process table. The flag remains for CI, which has no terminal.
    let token = opts.token;
    if (!token) {
      if (process.stdin.isTTY !== true) {
        fail(new Error("No terminal to prompt at. Pass --token, or set SKILLSET_REGISTRY and SKILLSET_TOKEN."));
        return;
      }
      token = await promptToken();
    }

    const s = p.spinner();
    s.start(`Verifying your Token against ${opts.registry}`);
    try {
      const result = await runLogin(
        { fetch, configPath: resolveConfigPath(process.env) },
        { registry: opts.registry, token },
      );
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
  .description("Publish the Skill at [path], or every Skill beneath it (defaults to the current directory).")
  .argument("[path]", "Path to a Skill's directory, or a directory holding several")
  .option("--yes", "Skip confirming a publish of more than one Skill")
  .action(async (path: string | undefined, opts: { yes?: boolean }) => {
    p.intro(label("publish"));
    const s = p.spinner();
    s.start("Validating and uploading");
    try {
      const result = await runPublish(
        {
          fetch,
          configPath: resolveConfigPath(process.env),
          env: process.env,
          cwd: process.cwd(),
          isTTY: process.stdin.isTTY === true,
          // Stopped and restarted around the prompt: an animating spinner and clack's own
          // interactive prompt both assume they own the terminal's render loop, and running
          // together garbles the output.
          confirm: async (names) => {
            s.stop("Waiting for confirmation");
            const proceed = await promptConfirm(`Publish and replace ${names.length} Skills: ${names.join(", ")}?`);
            s.start("Validating and uploading");
            return proceed;
          },
        },
        { path, yes: opts.yes },
      );

      if (!Array.isArray(result)) {
        s.stop(`Published ${pc.cyan(result.name)}`);
        p.outro(pc.dim(`${result.id} · ${result.published_at}`));
        return;
      }

      const failed = result.filter((outcome) => outcome.status === "failed");
      s.stop(`Published ${result.length - failed.length}/${result.length} Skills`);
      for (const outcome of result) {
        if (outcome.status === "published") {
          p.log.success(`${pc.cyan(outcome.name)} ${pc.dim(`(${outcome.id})`)}`);
        } else {
          p.log.error(`${pc.red(outcome.name)}: ${outcome.error}`);
        }
      }
      if (failed.length > 0) process.exitCode = 1;
      p.outro(failed.length > 0 ? pc.red(`${failed.length} Skill(s) failed`) : "Done");
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
      } else if (report.agent === null) {
        p.log.message(
          pc.dim("No Agent detected — installed into .agents/skills. Pass --agent to link it into a specific Agent's directory."),
        );
      } else {
        p.log.message(pc.dim(`${report.agent} reads .agents/skills directly`));
      }
      if (report.alsoServes.length > 0) {
        const names = report.alsoServes.map((id) => getAgent(id).displayName).join(", ");
        p.log.message(pc.dim(`Also serves: ${names} — no need to run this again for them.`));
      }
      p.outro("Done");
    } catch (error) {
      fail(error);
    }
  });

await program.parseAsync(process.argv);
