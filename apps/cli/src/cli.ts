#!/usr/bin/env node
import * as p from "@clack/prompts";
import { getAgent, importedSource } from "@in-org-quicko/skillset-shared";
import { Command } from "commander";
import { homedir } from "node:os";
import pc from "picocolors";
import { runInfo } from "./commands/info.js";
import { runInstall } from "./commands/install.js";
import type { SkillStatus } from "@in-org-quicko/skillset-installer";
import { runList } from "./commands/list.js";
import { runLogin } from "./commands/login.js";
import { runPublish } from "./commands/publish.js";
import { runRemove } from "./commands/remove.js";
import { runSearch } from "./commands/search.js";
import { runUpdate } from "./commands/update.js";
import { runWhoami } from "./commands/whoami.js";
import { resolveConfigPath } from "./config.js";
import { isRepositoryUrl } from "@in-org-quicko/skillset-installer";
import { emitJson, jsonMode, setJsonMode } from "./json.js";
import { bannerText, fail, promptAgent, promptChoice, promptConfirm, promptToken } from "./ui.js";

const program = new Command();
program.name("skillset").description("Publish and manage Skills on Skillset.");
program.addHelpText("beforeAll", bannerText());

/** `--json`'s help text, declared once and added to every command that has a result worth printing. */
const JSON_FLAG = "Print the result as JSON on stdout, and any failure as JSON on stderr. Never prompts.";

// Declared per subcommand rather than once on the root, so it reads where
// anyone would type it — `skillset search foo --json`, not
// `skillset --json search foo`. One hook then lifts whichever command was run
// into the module flag every action reads.
program.hook("preAction", (_root, actionCommand) => {
  setJsonMode(actionCommand.opts().json === true);
});
// A bare `skillset` prints the banner. Anything commander did not recognise
// as a subcommand lands here too, and is named back rather than reported as
// "too many arguments" — which is what a root action turns an unknown
// command into, and is unreadable to someone whose muscle memory or CI still
// holds a verb this CLI has since renamed.
program
  .argument("[command]")
  .allowExcessArguments()
  .action((command?: string) => {
    if (command) {
      console.error(pc.red(`Unknown command "${command}".`));
      process.exitCode = 1;
    }
    console.log(bannerText());
  });

const label = (verb: string) => pc.bgCyan(pc.black(` skillset ${verb} `));

program
  .command("login")
  .description("Authenticate the CLI against a Registry with a Token minted from the web interface.")
  .requiredOption("--registry <url>", "The Registry's URL")
  .option("--token <secret>", "A Token minted from the web interface (prompted for if omitted)")
  .option("--insecure", "Allow a plain-http Registry that is not on this machine (sends the Token in the clear)")
  .option("--json", JSON_FLAG)
  .action(async (opts: { registry: string; token?: string; insecure?: boolean }) => {
    if (jsonMode()) {
      const deps = { fetch, configPath: resolveConfigPath(process.env) };
      return emitJson(async () => {
        // The masked prompt is the interactive path's whole reason for
        // existing; under `--json` there is nobody to type into it, so the
        // Token has to arrive on the command line.
        if (!opts.token) throw new Error("Pass --token with --json: there is no terminal to prompt at.");
        return runLogin(deps, { registry: opts.registry, token: opts.token, insecure: opts.insecure });
      });
    }

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
        { registry: opts.registry, token, insecure: opts.insecure },
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
  .option("--json", JSON_FLAG)
  .action(async () => {
    const deps = { fetch, configPath: resolveConfigPath(process.env), env: process.env };
    if (jsonMode()) return emitJson(() => runWhoami(deps));

    p.intro(label("whoami"));
    const s = p.spinner();
    s.start("Resolving identity");
    try {
      const result = await runWhoami(deps);
      s.stop(`${pc.cyan(result.email)} ${pc.dim(`(${result.role})`)}`);
      p.outro(result.registry);
    } catch (error) {
      s.error(pc.red("Could not resolve identity"));
      fail(error);
    }
  });

program
  .command("publish")
  .description(
    "Publish a Skill to the Registry: from a path — one Skill's directory, or a directory holding several — " +
      "or from a GitHub or GitLab URL, cloned with your own git credentials.",
  )
  .argument("[target]", "A path (default: the current directory), or a GitHub or GitLab URL — a repository, or a folder in one")
  .option("--name <skill>", "Required with a URL: which Skill to publish, by the name in its SKILL.md")
  .option("--yes", "Skip confirming a publish of more than one Skill")
  .option("--json", JSON_FLAG)
  .addHelpText(
    "after",
    examples([
      "skillset publish                      # whatever is in this directory",
      "skillset publish ./skills --yes",
      "skillset publish https://github.com/acme/skills --name pdf",
    ]),
  )
  .action(async (target: string | undefined, opts: { name?: string; yes?: boolean }) => {
    const options = { target, skillName: opts.name, yes: opts.yes };
    // Non-interactive, for the same reason as `install` — so a multi-Skill
    // publish under `--json` needs `--yes` rather than a confirmation nobody
    // is there to give.
    if (jsonMode()) {
      const deps = {
        fetch,
        configPath: resolveConfigPath(process.env),
        env: process.env,
        cwd: process.cwd(),
        isTTY: false,
        confirm: async () => false,
      };
      return emitJson(async () => {
        const result = await runPublish(deps, options);
        // A partly-failed batch resolves rather than throws, so the exit code
        // is set here — otherwise `--json` would report success for a run the
        // formatted output calls a failure.
        if (Array.isArray(result) && result.some((outcome) => outcome.status === "failed")) process.exitCode = 1;
        return result;
      });
    }

    p.intro(label("publish"));
    const s = p.spinner();
    const uploading = "Validating and uploading";
    // A URL's first slow step is the clone, which reports itself; the upload
    // spinner takes over once it is done.
    if (!(target && isRepositoryUrl(target))) s.start(uploading);
    const progress = {
      start: (message: string) => s.start(message),
      stop: (message: string) => {
        s.stop(message);
        s.start(uploading);
      },
      fail: (message: string) => s.error(pc.red(message)),
    };
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
            s.start(uploading);
            return proceed;
          },
          progress,
        },
        options,
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

/** Formats a command's usage examples for the end of its `--help`. */
function examples(lines: readonly string[]): string {
  return `\nExamples:\n${lines.map((line) => `  $ ${line}`).join("\n")}`;
}

/** `install`'s flags as commander parses them. */
interface InstallFlags {
  name?: string;
  namespace?: string;
  agent?: string;
  scope?: string;
  copy?: boolean;
  force?: boolean;
}

program
  .command("install")
  .description(
    "Install a Skill for a coding Agent: by name from the Registry, or from a GitHub or GitLab URL, cloned with " +
      "your own git credentials and submitted to the Registry for approval.",
  )
  .argument("<target>", "A Skill's name in the Registry, or a GitHub or GitLab URL — a repository, or a folder in one")
  .option("--name <skill>", "Required with a URL: which Skill to install, by the name in its SKILL.md")
  .option("--namespace <ns>", "Which party named the Skill, when a bare name matches more than one")
  .option("--agent <id>", "Agent to install for (run with no value to pick from the list)")
  .option("--scope <scope>", "Install scope: project or user")
  .option("--copy", "Copy the Skill into the Agent's own directory instead of symlinking to .agents/skills")
  .option("--force", "Replace an already-installed Skill that has local changes, or that a different party named")
  .option("--json", JSON_FLAG)
  .addHelpText(
    "after",
    examples([
      "skillset install code-review",
      "skillset install pdf --namespace anthropics/skills",
      "skillset install https://github.com/anthropics/skills --name pdf",
    ]),
  )
  .action(async (target: string, opts: InstallFlags) => {
    const deps = {
      fetch,
      configPath: resolveConfigPath(process.env),
      env: process.env,
      cwd: process.cwd(),
      homeDir: homedir(),
      // `--json` is non-interactive whatever the terminal says: a clack prompt
      // would write to the same stdout the payload goes to, and a caller
      // parsing it has nobody to answer. Unresolved choices then fail with a
      // JSON error naming the flag to pass instead of hanging.
      isTTY: jsonMode() ? false : process.stdin.isTTY === true,
      promptChoice,
      promptAgent,
    };
    const options = {
      name: target,
      skillName: opts.name,
      namespace: opts.namespace,
      agent: opts.agent,
      scope: opts.scope,
      copy: opts.copy,
      force: opts.force,
    };
    if (jsonMode()) return emitJson(() => runInstall(deps, options));

    p.intro(label("install"));
    const s = p.spinner();
    const progress = {
      start: (message: string) => s.start(message),
      stop: (message: string) => s.stop(message),
      fail: (message: string) => s.error(pc.red(message)),
    };
    try {
      const report = await runInstall({ ...deps, progress }, options);
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
      const submission = report.submission;
      if (submission?.status === "submitted") {
        p.log.info("Submitted to the Registry — an Admin can approve it from the web interface.");
      } else if (submission?.status === "already-published") {
        p.log.message(pc.dim("Already in the Registry — nothing to submit."));
      } else if (submission?.status === "not-logged-in") {
        p.log.warn("Not submitted to the Registry — run `skillset login` and install again to submit it.");
      } else if (submission?.status === "failed") {
        p.log.warn(`Installed, but not submitted to the Registry: ${submission.message}`);
      }
      p.outro("Done");
    } catch (error) {
      fail(error);
    }
  });

/** How each status reads in the listing — the two that need a decision are the two that are coloured. */
const STATUS_LABEL: Record<SkillStatus, string> = {
  current: pc.dim("current"),
  outdated: pc.yellow("outdated"),
  modified: pc.magenta("modified"),
  missing: pc.red("missing"),
};

program
  .command("list")
  .description("Show the Skills installed here, and whether each is current, outdated, locally modified, or missing.")
  .option("--scope <scope>", "Which scope to list: project or user (default: project)")
  .option("--offline", "Skip the Registry, so nothing is reported as outdated")
  .option("--json", JSON_FLAG)
  .action(async (opts: { scope?: string; offline?: boolean }) => {
    const deps = { fetch, configPath: resolveConfigPath(process.env), env: process.env, cwd: process.cwd(), homeDir: homedir() };
    const options = { scope: opts.scope, offline: opts.offline };
    if (jsonMode()) return emitJson(() => runList(deps, options));

    p.intro(label("list"));
    const s = p.spinner();
    s.start("Reading installed Skills");
    try {
      const report = await runList(deps, options);

      if (report.skills.length === 0) {
        s.stop(`No Skills installed at ${report.scope} scope`);
        p.outro(pc.dim("Run `skillset install <name>` to install one."));
        return;
      }

      s.stop(`${report.skills.length} Skill(s) at ${pc.cyan(report.scope)} scope`);
      const width = Math.max(...report.skills.map((skill) => skill.name.length));
      for (const skill of report.skills) {
        p.log.message(`${skill.name.padEnd(width)}  ${STATUS_LABEL[skill.status]}`);
      }
      if (report.offline) {
        p.log.warn("Registry not consulted — nothing here can be reported as outdated.");
      }
      p.outro(pc.dim(report.lockfilePath));
    } catch (error) {
      s.error(pc.red("Could not list installed Skills"));
      fail(error);
    }
  });

program
  .command("update")
  .description("Re-download installed Skills the Registry has moved on from. Updates every one when none is named.")
  .argument("[names...]", "The Skills to update")
  .option("--scope <scope>", "Which scope to update: project or user (default: project)")
  .option("--force", "Update a Skill with local changes, discarding them")
  .option("--json", JSON_FLAG)
  .action(async (names: string[], opts: { scope?: string; force?: boolean }) => {
    const deps = { fetch, configPath: resolveConfigPath(process.env), env: process.env, cwd: process.cwd(), homeDir: homedir() };
    const options = { names, scope: opts.scope, force: opts.force };
    if (jsonMode()) {
      return emitJson(async () => {
        const outcomes = await runUpdate(deps, options);
        // Same as `publish`: a per-Skill failure resolves, so the exit code has
        // to be set from the outcomes rather than left to `emitJson`'s catch.
        if (outcomes.some((outcome) => outcome.status === "error")) process.exitCode = 1;
        return outcomes;
      });
    }

    p.intro(label("update"));
    const s = p.spinner();
    s.start("Checking the Registry");
    try {
      const outcomes = await runUpdate(deps, options);

      const changed = outcomes.filter((o) => o.status === "updated" || o.status === "restored").length;
      const failed = outcomes.filter((o) => o.status === "error").length;
      s.stop(outcomes.length === 0 ? "Nothing installed to update" : `${changed} of ${outcomes.length} Skill(s) changed`);

      for (const outcome of outcomes) {
        if (outcome.status === "updated") p.log.success(`${pc.cyan(outcome.name)} updated`);
        else if (outcome.status === "restored") p.log.success(`${pc.cyan(outcome.name)} restored — its files were missing`);
        else if (outcome.status === "up-to-date") p.log.message(pc.dim(`${outcome.name} already current`));
        else if (outcome.status === "gone") p.log.warn(`${outcome.name} is no longer on the Registry — left installed`);
        else if (outcome.status === "pending") p.log.message(pc.dim(`${outcome.name} is waiting on an Admin's approval`));
        else if (outcome.status === "skipped") {
          p.log.warn(`${outcome.name} has local changes — pass --force to replace it`);
        } else p.log.error(`${pc.red(outcome.name)}: ${outcome.message}`);
      }

      if (failed > 0) process.exitCode = 1;
      p.outro(failed > 0 ? pc.red(`${failed} Skill(s) failed`) : "Done");
    } catch (error) {
      s.error(pc.red("Update failed"));
      fail(error);
    }
  });

program
  .command("remove")
  .description("Uninstall a Skill: its files, the Agent's link to it, and its lockfile entry.")
  .argument("<name>", "The Skill's name")
  .option("--scope <scope>", "Which scope to remove from: project or user (default: project)")
  .option("--json", JSON_FLAG)
  .action(async (name: string, opts: { scope?: string }) => {
    const deps = { fetch, configPath: resolveConfigPath(process.env), env: process.env, cwd: process.cwd(), homeDir: homedir() };
    const options = { name, scope: opts.scope };
    if (jsonMode()) return emitJson(() => runRemove(deps, options));

    p.intro(label("remove"));
    try {
      const report = await runRemove(deps, options);

      if (!report.skillDirectory && !report.link && !report.forgotten) {
        p.log.warn(`${name} was not installed at ${report.scope} scope — nothing to remove.`);
        p.outro("Done");
        return;
      }

      p.log.success(`Removed ${pc.cyan(name)}`);
      if (report.skillDirectory) p.log.message(pc.dim(report.skillDirectory));
      if (report.link) p.log.message(pc.dim(`unlinked ${report.link}`));
      p.outro("Done");
    } catch (error) {
      fail(error);
    }
  });

program
  .command("search")
  .description("Search the Registry's catalog. Lists everything when given no term.")
  .argument("[query]", "What to search for — a task, or an exact Skill name")
  .option("--tag <name>", "Narrow to Skills carrying this Tag")
  .option("--limit <n>", "Maximum number of results")
  .option("--json", JSON_FLAG)
  .action(async (query: string | undefined, opts: { tag?: string; limit?: string }) => {
    const deps = { fetch, configPath: resolveConfigPath(process.env), env: process.env };
    const options = { query, tag: opts.tag, limit: opts.limit };
    if (jsonMode()) return emitJson(() => runSearch(deps, options));

    p.intro(label("search"));
    const s = p.spinner();
    s.start(query ? `Searching for ${query}` : "Listing the catalog");
    try {
      const report = await runSearch(deps, options);

      if (report.items.length === 0) {
        s.stop("No Skills matched");
        p.outro(pc.dim(query ? "Try a broader term, or run `skillset search` with none." : "Nothing published yet."));
        return;
      }

      s.stop(`${report.total} Skill(s) matched`);
      for (const item of report.items) {
        // The Namespace only where it says something: a Skill published to
        // this Registry is named by it, and repeating that on every row is
        // noise. One Imported from elsewhere shows the string to pass to
        // `install --namespace`, which is the row a reader may have to
        // disambiguate. Same rule `importedSource` applies to the Source
        // itself (ADR-0041).
        const from = importedSource(item.source) ? pc.dim(` ${item.namespace}`) : "";
        p.log.message(`${pc.cyan(item.name)}${from}\n${pc.dim(item.description)}`);
      }
      p.outro(
        report.truncated
          ? pc.dim(`Showing ${report.items.length} of ${report.total} — pass --limit for more.`)
          : pc.dim("Run `skillset info <name>` to read one."),
      );
    } catch (error) {
      s.error(pc.red("Search failed"));
      fail(error);
    }
  });

program
  .command("info")
  .description("Show a Skill's SKILL.md and details without installing it.")
  .argument("<name>", "The Skill's name")
  .option("--files", "Also list every file the Skill ships")
  .option("--json", JSON_FLAG)
  .action(async (name: string, opts: { files?: boolean }) => {
    const deps = { fetch, configPath: resolveConfigPath(process.env), env: process.env };
    const options = { name, files: opts.files };
    if (jsonMode()) return emitJson(() => runInfo(deps, options));

    p.intro(label("info"));
    const s = p.spinner();
    s.start(`Reading ${name}`);
    try {
      const { skill, files } = await runInfo(deps, options);

      s.stop(pc.cyan(skill.name));
      p.log.message(skill.description);
      const facts = [
        `published by ${skill.published_by.first_name ?? skill.published_by.email}`,
        `updated ${skill.updated_at}`,
        `${skill.installs} install(s)`,
        ...(skill.tags.length > 0 ? [`tags: ${skill.tags.map((tag) => tag.name).join(", ")}`] : []),
        ...(skill.license ? [`license: ${skill.license}`] : []),
        // Only when it points somewhere else. Telling someone who just asked a
        // Registry about a Skill that the Skill came from that Registry is not
        // a fact, and the same rule hides the interface's Source row.
        // Both, and only when it came from elsewhere: the Source says where
        // to look, the Namespace is the string `install --namespace` takes.
        ...(importedSource(skill.source) ? [`namespace: ${skill.namespace}`, `source: ${skill.source}`] : []),
      ];
      p.log.message(pc.dim(facts.join(" · ")));

      // Its own line rather than another dimmed fact: this is what the Skill
      // claims the right to reach once loaded, and installing is what grants
      // it — the one detail here worth reading before `skillset install`.
      if (skill.allowed_tools) {
        p.log.message(`${pc.yellow("tool access")}  ${skill.allowed_tools}`);
      }

      if (files) {
        p.log.message(pc.dim(files.map((file) => `  ${file.path}  ${file.size}B`).join("\n")));
      }

      p.log.message(skill.body);
      p.outro(pc.dim(`skillset install ${skill.name}`));
    } catch (error) {
      s.error(pc.red("Could not read that Skill"));
      fail(error);
    }
  });

await program.parseAsync(process.argv);
