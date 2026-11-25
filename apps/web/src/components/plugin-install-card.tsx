import { PLUGIN_AGENTS, type Plugin, type PluginAgent } from "@in-org-quicko/skillset-shared";
import { useState } from "react";
import { CopyableCode } from "@/components/copyable-code";
import { Panel } from "@/components/panel";
import { PLUGIN_INSTALL_GUIDES } from "@/lib/plugin-install";
import { cn } from "@/lib/utils";

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
        <div role="tablist" className="flex gap-3.5 text-xs">
          {plugin.agents.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={id === agent}
              onClick={() => setChosen(id)}
              className={cn(
                "cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                id === agent ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {PLUGIN_AGENTS[id].label}
            </button>
          ))}
        </div>
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
