import {
  CLAUDE_MARKETPLACE_NAME,
  CLAUDE_MARKETPLACE_PATH,
  claudeMarketplaceEntryName,
  registryNamespace,
  type PluginAgent,
} from "@in-org-quicko/skillset-shared";

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

/**
 * How to install a Plugin on each agent the Registry supports.
 *
 * @remarks
 * Keyed by every `PluginAgent`, so adding an agent to `PLUGIN_AGENTS` does not
 * typecheck until its install guide is written here.
 */
export const PLUGIN_INSTALL_GUIDES: Record<PluginAgent, (context: PluginInstallContext) => PluginInstallGuide> = {
  "claude-code": ({ name, namespace, origin }) => {
    const entry = claudeMarketplaceEntryName(name, namespace, namespace === registryNamespace(origin));
    return {
      steps: [
        {
          text: "Add this Registry's marketplace to Claude Code. You do this once.",
          command: `claude plugin marketplace add ${origin}${CLAUDE_MARKETPLACE_PATH}`,
        },
        { text: "Install the plugin.", command: `claude plugin install ${entry}@${CLAUDE_MARKETPLACE_NAME}` },
      ],
      note: origin.startsWith("https://")
        ? undefined
        : "Claude Code downloads plugins only over HTTPS. This Registry is served over HTTP, so the install fails until it is served over HTTPS.",
    };
  },
};
