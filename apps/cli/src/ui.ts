import * as p from "@clack/prompts";
import pc from "picocolors";
import { ApiError } from "./http.js";

const LOGO = [
  "███████╗██╗  ██╗██╗██╗     ██╗     ███████╗███████╗████████╗",
  "██╔════╝██║ ██╔╝██║██║     ██║     ██╔════╝██╔════╝╚══██╔══╝",
  "███████╗█████╔╝ ██║██║     ██║     ███████╗█████╗     ██║   ",
  "╚════██║██╔═██╗ ██║██║     ██║     ╚════██║██╔══╝     ██║   ",
  "███████║██║  ██╗██║███████╗███████╗███████║███████╗   ██║   ",
  "╚══════╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚══════╝╚══════╝   ╚═╝   ",
];

// Grouped the way the commands divide: signing in, then the Registry's
// catalog, then this project's installed copies. `search` and `list` read
// alike and answer different questions, so they are described against each
// other rather than in isolation.
//
// Each row carries the flags a reader would not think to look for — a
// Namespace on `install`, and installing or publishing from a URL at all.
// `install <url>` and `publish --from` each get a row of their own rather than
// a bracket on the one above: neither takes the other form's arguments, so
// showing both in one line would suggest they combine.
const COMMANDS: readonly (readonly [string, string])[] = [
  ["skillset login --registry <url> --token <token>", "Authenticate this machine against a Registry"],
  ["skillset whoami", "Show which Registry and identity are active"],
  ["skillset search [query] [--tag <name>]", "Search the Registry's catalog, or list all of it"],
  ["skillset info <name> [--files]", "Read a Skill without installing it"],
  ["skillset install <name> [--namespace <ns>] [--agent <id>]", "Install a Skill from the Registry for a coding Agent"],
  ["skillset install <url> [--agent <id>]", "Install from a GitHub or GitLab folder with your git, and submit it for approval"],
  ["skillset list [--scope <scope>]", "Show what this project has installed, and whether it is current"],
  ["skillset update [names...] [--force]", "Re-download Skills the Registry has moved on from"],
  ["skillset remove <name>", "Uninstall a Skill from this project"],
  ["skillset publish [path] [--source <url>]", "Publish a Skill, or every Skill under a directory"],
  ["skillset publish --from <url>", "Publish from a public GitHub or GitLab URL"],
];

/**
 * Renders the wordmark, tagline, and command list shown for a bare `skillset`
 * invocation and at the top of `--help`.
 *
 * @returns The banner as a single string, ready to hand to `console.log` or
 * commander's `addHelpText`. The ASCII logo is dropped on terminals narrower
 * than 62 columns, leaving just the tagline and commands.
 *
 * @example
 * ```ts
 * console.log(bannerText());
 * ```
 */
export function bannerText(): string {
  const wide = (process.stdout.columns ?? 80) >= 62;
  const lines: string[] = [""];

  if (wide) {
    LOGO.forEach((line) => lines.push(pc.bold(line)));
    lines.push("");
  }

  lines.push(`  ${pc.dim("Publish and manage Skills on Skillset")}`, "");

  const pad = Math.max(...COMMANDS.map(([cmd]) => cmd.length));
  for (const [cmd, desc] of COMMANDS) {
    lines.push(`  ${pc.dim("$")} ${pc.cyan(cmd.padEnd(pad))}  ${pc.dim(desc)}`);
  }

  // Noted once rather than appended to all nine lines above, which would
  // double the width of the widest of them for a flag that reads the same on
  // every command.
  lines.push("", `  ${pc.dim("Add --json to any command for machine-readable output.")}`);

  return lines.join("\n");
}

/**
 * Turns a caught error into the headline and optional second line the CLI prints.
 *
 * @param error - Whatever the command threw.
 * @returns `title`, always shown; `detail`, a dimmed follow-up line when there is more
 * worth saying.
 *
 * @remarks
 * An {@link ApiError} carries the Registry's HTTP status and error code, which a bare
 * `.message` hides. A 5xx is called out as a Registry-side fault — the caller's request
 * was fine and the fix is in the Registry's logs, not in re-running with different
 * arguments — so it is not mistaken for a user error. Any other error is shown as-is.
 *
 * @example
 * ```ts
 * describeError(new ApiError(500, "internal_error", "Something went wrong."));
 * // -> { title: "The Registry hit an internal error (HTTP 500, internal_error).", detail: "…" }
 * ```
 */
export function describeError(error: unknown): { title: string; detail?: string } {
  if (error instanceof ApiError) {
    if (error.status >= 500) {
      return {
        title: `The Registry hit an internal error (HTTP ${error.status}, ${error.code}).`,
        detail:
          "This is a fault on the Registry itself, not your request. Check the Registry's server logs for the stack trace.",
      };
    }
    return {
      title: `${error.message}${error.field ? ` (${error.field})` : ""}`,
      detail: `HTTP ${error.status} · ${error.code}`,
    };
  }
  return { title: error instanceof Error ? error.message : String(error) };
}

/**
 * Closes a command's clack sequence with the failure and sets a non-zero exit code.
 *
 * @param error - Whatever the command threw; formatted through {@link describeError}.
 *
 * @remarks
 * Every command opens with {@link p.intro}, so this always has an open message tree
 * to close — it renders the failure and then an outro, rather than leaving the tree
 * dangling.
 *
 * @example
 * ```ts
 * try {
 *   await runPublish(deps, options);
 * } catch (error) {
 *   fail(error);
 * }
 * ```
 */
export function fail(error: unknown): void {
  const { title, detail } = describeError(error);
  p.log.error(pc.red(title));
  if (detail) p.log.message(pc.dim(detail));
  p.outro(pc.red("Command failed"));
  process.exitCode = 1;
}

/**
 * Asks the User to pick one value from a list, using clack's select prompt.
 *
 * @param question - The line shown above the choices.
 * @param choices - The selectable values, in order; each is its own label. Must not be empty.
 * @returns The chosen entry of `choices`.
 *
 * @remarks
 * Injected into `runInstall` as `deps.promptChoice`, which only calls it when a terminal is
 * attached and the matching flag was omitted. On Ctrl-C (clack reports a cancel) the
 * process exits 1 rather than returning a bogus value.
 *
 * @example
 * ```ts
 * const scope = await promptChoice("Install for which scope?", ["project", "user"]);
 * ```
 */
export async function promptChoice(question: string, choices: readonly string[]): Promise<string> {
  const answer = await p.select({
    message: question,
    options: choices.map((value) => ({ value, label: value })),
  });

  if (p.isCancel(answer)) {
    p.cancel("Cancelled.");
    process.exit(1);
  }

  return answer as string;
}

/**
 * Asks the User to confirm or cancel, using clack's confirm prompt.
 *
 * @param question - The line shown with the yes/no choice.
 * @returns Whether the User confirmed.
 *
 * @remarks
 * Injected into `runPublish` as `deps.confirm`, called only when a terminal is attached and
 * publishing more than one Skill was not already confirmed with `--yes`. Unlike the other
 * prompts here, a Ctrl-C is not forced to exit: cancelling a confirmation is answering "no",
 * not an unrecoverable interruption.
 *
 * @example
 * ```ts
 * const proceed = await promptConfirm("Publish 3 Skills, replacing any of the same name?");
 * ```
 */
export async function promptConfirm(question: string): Promise<boolean> {
  const answer = await p.confirm({ message: question });
  return p.isCancel(answer) ? false : answer;
}

/**
 * Asks the User to pick one Agent from the full table, using clack's searchable
 * autocomplete prompt — the list is too long for a plain select.
 *
 * @param choices - Every Agent, each shown by display name with its id as a hint.
 * @returns The chosen Agent's id.
 *
 * @remarks
 * Injected into `runInstall` as `deps.promptAgent`, called only with a terminal attached and
 * `--agent` omitted. On Ctrl-C (clack reports a cancel) the process exits 1.
 *
 * @example
 * ```ts
 * const id = await promptAgent([{ id: "claude-code", displayName: "Claude Code" }]);
 * ```
 */
export async function promptAgent(choices: readonly { id: string; displayName: string }[]): Promise<string> {
  const options: { value: string; label: string; hint: string }[] = choices.map((choice) => ({
    value: choice.id,
    label: choice.displayName,
    hint: choice.id,
  }));

  const answer = await p.autocomplete({ message: "Install for which Agent?", options, maxItems: 10 });

  if (p.isCancel(answer)) {
    p.cancel("Cancelled.");
    process.exit(1);
  }

  return answer;
}

/**
 * Asks the User to paste a Token, with the input masked.
 *
 * @returns The Token, trimmed.
 *
 * @remarks
 * Prompted rather than taken as `--token <secret>`, which put the Token into shell
 * history and, for the life of the process, into the process table where any other
 * account on the machine could read it. The flag still exists for CI, where there is no
 * terminal to prompt at; interactively, this is the path.
 *
 * On Ctrl-C (clack reports a cancel) the process exits 1, matching the other prompts.
 *
 * @example
 * ```ts
 * const token = opts.token ?? (await promptToken());
 * ```
 */
export async function promptToken(): Promise<string> {
  const answer = await p.password({
    message: "Paste a Token minted from the web interface",
    validate: (value) => ((value ?? "").trim().length > 0 ? undefined : "A Token is required."),
  });

  if (p.isCancel(answer)) {
    p.cancel("Cancelled.");
    process.exit(1);
  }

  return answer.trim();
}
