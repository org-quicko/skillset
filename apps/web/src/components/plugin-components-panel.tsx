import type { Plugin, PluginComponent, PluginComponents } from "@in-org-quicko/skillset-shared";
import { useState } from "react";
import { Panel } from "@/components/panel";
import { cn } from "@/lib/utils";

/** Each component kind's tab, in the order they show. */
const COMPONENT_KINDS: { key: keyof PluginComponents; label: string; prefix?: string }[] = [
  { key: "skills", label: "Skills" },
  { key: "commands", label: "Commands", prefix: "/" },
  { key: "agents", label: "Agents" },
  { key: "hooks", label: "Hooks" },
  { key: "mcp_servers", label: "MCP servers" },
];

/**
 * What a Plugin provides — its skills, commands, agents, hook events, and MCP
 * servers — one tab per kind it has.
 *
 * @remarks
 * Read from the Plugin's files when it was published. A Plugin published
 * before that has none recorded, and the panel says to publish it again.
 *
 * @param plugin - The Plugin.
 * @param onOpenFile - Called with a component's file when the reader picks it.
 */
export function PluginComponentsPanel({
  plugin,
  onOpenFile,
}: {
  plugin: Plugin;
  onOpenFile: (path: string) => void;
}) {
  const components = plugin.components;
  const present = components ? COMPONENT_KINDS.filter(({ key }) => components[key].length > 0) : [];
  const [chosen, setChosen] = useState<keyof PluginComponents>();
  const active = present.find(({ key }) => key === chosen) ?? present[0];

  return (
    <Panel
      title="What's inside"
      action={
        present.length > 0 && (
          <div role="tablist" className="flex gap-3.5 text-xs">
            {present.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={key === active?.key}
                onClick={() => setChosen(key)}
                className={cn(
                  "cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  key === active?.key ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label} <span className="tabular-nums opacity-70">{components?.[key].length}</span>
              </button>
            ))}
          </div>
        )
      }
    >
      {!components ? (
        <p className="text-sm text-pretty text-muted-foreground">
          This plugin was published before Skillset listed what plugins contain. Publish it again to see its skills,
          commands, agents, hooks, and MCP servers.
        </p>
      ) : !active ? (
        <p className="text-sm text-pretty text-muted-foreground">
          No skills, commands, agents, hooks, or MCP servers were found in this plugin&apos;s default folders.
        </p>
      ) : (
        <ul className="-mx-2 flex max-h-80 flex-col overflow-y-auto">
          {components[active.key].map((component: PluginComponent) => (
            <li key={`${component.path}#${component.name}`}>
              <button
                type="button"
                onClick={() => onOpenFile(component.path)}
                title={`Open ${component.path}`}
                className="flex w-full cursor-pointer flex-col gap-0.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/60"
              >
                <span className="font-mono text-[13px]">
                  {active.prefix}
                  {component.name}
                </span>
                {component.description && (
                  <span className="line-clamp-2 text-xs text-pretty text-muted-foreground">{component.description}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
