import type { Plugin, PluginComponent, PluginComponents } from "@in-org-quicko/skillset-shared";
import { useState } from "react";
import { Panel } from "@/components/panel";
import { PanelTabs } from "@/components/panel-tabs";

/** Each component kind's tab, in the order they show. */
const COMPONENT_KINDS: { key: keyof PluginComponents; label: string; prefix?: string }[] = [
  { key: "skills", label: "Skills" },
  { key: "commands", label: "Commands", prefix: "/" },
  { key: "agents", label: "Agents" },
  { key: "hooks", label: "Hooks" },
  { key: "mods", label: "Mods" },
  { key: "mcp_servers", label: "MCP servers" },
];

/**
 * What a Plugin provides — its skills, commands, agents, hook events, mods, and
 * MCP servers — one tab per kind it has.
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
      title="What's Inside"
      action={
        active && (
          <PanelTabs
            tabs={present.map(({ key, label }) => ({
              id: key,
              label: (
                <>
                  {label} <span className="tabular-nums opacity-70">{components?.[key].length}</span>
                </>
              ),
            }))}
            value={active.key}
            onChange={setChosen}
          />
        )
      }
    >
      {!components ? (
        <p className="text-sm text-pretty text-muted-foreground">
          This plugin was published before Skillset listed what plugins contain. Publish it again to see its skills,
          commands, agents, hooks, mods, and MCP servers.
        </p>
      ) : !active ? (
        <p className="text-sm text-pretty text-muted-foreground">
          No skills, commands, agents, hooks, mods, or MCP servers were found in this plugin&apos;s default folders.
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
                  <span className="truncate text-xs text-muted-foreground">{component.description}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
