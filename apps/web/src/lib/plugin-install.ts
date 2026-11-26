import { registryNamespace, type PluginAgent } from "@in-org-quicko/skillset-shared";

/** One step of installing a Plugin: what to do, and the command to run when there is one. */
export interface PluginInstallStep {
  text: string;
  command?: string;
}

/** How to install one Plugin on one agent. */
export interface PluginInstallGuide {
  steps: PluginInstallStep[];
  /** A caveat the reader needs before following the steps. */
  note?: string;
}

/** What every agent's guide is built from. */
export interface PluginInstallContext {
  name: string;
  namespace: string;
  /** The Registry's public origin, e.g. `https://skills.acme.com`. */
  origin: string;
}

/** What the CLI is published as — the name `npx` has to be given to reach it. */
const CLI_PACKAGE = "@in-org-quicko/skillset-cli";

/** How a plugin installed with the CLI is kept up to date, for every agent. */
const UPDATE_NOTE = "Run skillset plugins update to bring it up to date after a new version is published.";

/** The `skillset plugins install` command that installs a Plugin for one agent. */
function cliInstallCommand(
  { name, namespace, origin }: PluginInstallContext,
  agent: PluginAgent,
): string {
  const qualifier = namespace === registryNamespace(origin) ? "" : ` --namespace ${namespace}`;
  return `npx ${CLI_PACKAGE} plugins install ${name}${qualifier} --agent ${agent}`;
}

/**
 * How to install a Plugin on each agent the Registry supports.
 *
 * @remarks
 * Keyed by every `PluginAgent`, so adding an agent to `PLUGIN_AGENTS` does not
 * typecheck until its install guide is written here.
 */
export const PLUGIN_INSTALL_GUIDES: Record<
  PluginAgent,
  (context: PluginInstallContext) => PluginInstallGuide
> = {
  "claude-code": (context) => ({
    steps: [
      {
        text: "Install the plugin with the Skillset CLI. It adds this Registry's marketplace to Claude Code and runs claude plugin install.",
        command: cliInstallCommand(context, "claude-code"),
      },
      { text: "Restart Claude Code to load it." },
    ],
    note: `Needs the claude CLI on your PATH. ${UPDATE_NOTE}`,
  }),
  cursor: (context) => ({
    steps: [
      {
        text: "Install the plugin with the Skillset CLI. It copies the plugin into ~/.cursor/plugins/local.",
        command: cliInstallCommand(context, "cursor"),
      },
      { text: 'Restart Cursor, or run "Developer: Reload Window", to load it.' },
    ],
    note: `Cursor has no command to install a plugin from a marketplace, so the CLI copies it in. ${UPDATE_NOTE}`,
  }),
  codex: (context) => ({
    steps: [
      {
        text: "Install the plugin with the Skillset CLI. It adds a local Skillset marketplace to Codex and runs codex plugin add.",
        command: cliInstallCommand(context, "codex"),
      },
    ],
    note: `Needs the codex CLI on your PATH. ${UPDATE_NOTE}`,
  }),
};
