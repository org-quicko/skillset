import { PLUGIN_AGENTS, type Plugin, type PluginAgent } from "@in-org-quicko/skillset-shared";
import { useState } from "react";
import { AGENT_ICONS } from "@/components/agent-icons";
import { CopyableCode } from "@/components/copyable-code";
import { Panel } from "@/components/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PLUGIN_INSTALL_GUIDES } from "@/lib/plugin-install";

function AgentLabel({ agent }: { agent: PluginAgent }) {
  const Icon = AGENT_ICONS[agent];
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="size-3.5" />
      {PLUGIN_AGENTS[agent].label}
    </span>
  );
}

/**
 * The Installation panel for a Plugin: the chosen agent's install steps, under a
 * dropdown of the agents the Plugin supports, or just the agent's name when it
 * supports one.
 *
 * @remarks
 * The choices are the Plugin's own `agents`, so an agent it has no manifest for
 * is never offered (spec: "detect, do not convert").
 */
export function PluginInstallCard({ plugin }: { plugin: Plugin }) {
  const [chosen, setChosen] = useState<PluginAgent | undefined>(plugin.agents[0]);
  const agent = chosen && plugin.agents.includes(chosen) ? chosen : plugin.agents[0];
  if (!agent) return null;
  const guide = PLUGIN_INSTALL_GUIDES[agent]({
    name: plugin.name,
    namespace: plugin.namespace,
    origin: window.location.origin,
  });

  return (
    <Panel
      title="Installation"
      action={
        plugin.agents.length === 1 ? (
          <span className="flex h-7 items-center text-sm">
            <AgentLabel agent={agent} />
          </span>
        ) : (
          <Select
            value={agent}
            onValueChange={(value) => setChosen(plugin.agents.find((id) => id === value))}
          >
            <SelectTrigger size="sm" aria-label="Agent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {plugin.agents.map((id) => (
                <SelectItem key={id} value={id}>
                  <AgentLabel agent={id} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      }
    >
      <ol className="flex flex-col gap-3">
        {guide.steps.map((step, index) => (
          <li key={step.text} className="flex flex-col gap-1.5">
            <span className="text-sm text-muted-foreground">
              {guide.steps.length > 1 ? `${index + 1}. ` : ""}
              {step.text}
            </span>
            {step.command && <CopyableCode code={step.command} />}
          </li>
        ))}
      </ol>
      {guide.note && <p className="mt-3 text-xs text-pretty text-muted-foreground">{guide.note}</p>}
    </Panel>
  );
}
