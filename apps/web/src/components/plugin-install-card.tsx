import { PLUGIN_AGENTS, type Plugin, type PluginAgent } from "@in-org-quicko/skillset-shared";
import { useState } from "react";
import { CopyableCode } from "@/components/copyable-code";
import { Panel } from "@/components/panel";
import { PanelTabs } from "@/components/panel-tabs";
import { PLUGIN_INSTALL_GUIDES } from "@/lib/plugin-install";

/**
 * The Installation panel for a Plugin: one tab per agent the Plugin supports,
 * each with that agent's install steps.
 *
 * @remarks
 * The tabs are the Plugin's own `agents`, so an agent it has no manifest for
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
        <PanelTabs
          tabs={plugin.agents.map((id) => ({ id, label: PLUGIN_AGENTS[id].label }))}
          value={agent}
          onChange={setChosen}
        />
      }
    >
      <ol className="flex flex-col gap-3">
        {guide.steps.map((step, index) => (
          <li key={step.text} className="flex flex-col gap-1.5">
            <span className="text-sm text-muted-foreground">
              {index + 1}. {step.text}
            </span>
            {step.command && <CopyableCode code={step.command} />}
          </li>
        ))}
      </ol>
      {guide.note && <p className="mt-3 text-xs text-pretty text-muted-foreground">{guide.note}</p>}
    </Panel>
  );
}
