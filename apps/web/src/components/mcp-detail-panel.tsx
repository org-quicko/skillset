import type { McpDetail } from "@in-org-quicko/skillset-shared";
import { GlobeIcon, TerminalIcon } from "lucide-react";
import { useState } from "react";
import { CopyableCode } from "@/components/copyable-code";
import { Panel } from "@/components/panel";
import { Badge } from "@/components/ui/badge";
import { mcpClientSnippets, type McpClient } from "@/lib/mcp-client-config";
import { renderSkillBody } from "@/lib/render-skill-body";
import { cn } from "@/lib/utils";

/**
 * How to add the server to each client, one tab per client. The tab choice
 * is not kept in the URL: it is a reading preference, not a view to share.
 */
function McpConfigPanel({ mcp }: { mcp: McpDetail }) {
  const snippets = mcpClientSnippets(mcp);
  const [client, setClient] = useState<McpClient>("mcp-json");
  const snippet = snippets.find((s) => s.client === client) ?? snippets[0];
  if (!snippet) return null;

  return (
    <Panel
      title="Configuration"
      action={
        <div role="tablist" className="flex gap-3.5 text-xs">
          {snippets.map((s) => (
            <button
              key={s.client}
              type="button"
              role="tab"
              aria-selected={s.client === snippet.client}
              onClick={() => setClient(s.client)}
              className={cn(
                "cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                s.client === snippet.client ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="flex flex-col gap-2">
        <span className="font-mono text-xs text-muted-foreground">{snippet.target}</span>
        <CopyableCode code={snippet.code} />
        {snippet.note && <p className="text-xs text-muted-foreground">{snippet.note}</p>}
      </div>
    </Panel>
  );
}

export function McpDetailPanel({ mcp }: { mcp: McpDetail }) {
  return (
    <div className="flex flex-col gap-4">
      <McpConfigPanel mcp={mcp} />

      {/* Package / Remotes metadata */}
      {mcp.packages && mcp.packages.length > 0 && (
        <Panel title="Package Details">
          <div className="flex flex-col gap-3">
            {mcp.packages.map((pkg, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-lg border p-3.5 text-sm">
                <div className="flex items-center gap-2">
                  <TerminalIcon className="size-4 text-muted-foreground" />
                  <span className="font-semibold">{pkg.name}</span>
                  <Badge variant="outline">{pkg.registry_name}</Badge>
                  {pkg.version && <Badge variant="secondary">{pkg.version}</Badge>}
                </div>

                {pkg.environment_variables && pkg.environment_variables.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Environment Variables:</span>
                    <div className="flex flex-col gap-1">
                      {pkg.environment_variables.map((ev) => (
                        <div key={ev.name} className="flex items-center gap-2 font-mono text-xs">
                          <span className="font-bold">{ev.name}</span>
                          {ev.required && (
                            <Badge variant="destructive" className="px-1 py-0 text-[10px]">
                              Required
                            </Badge>
                          )}
                          {ev.description && <span className="text-muted-foreground">— {ev.description}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {mcp.remotes && mcp.remotes.length > 0 && (
        <Panel title="Remote Connection">
          <div className="flex flex-col gap-3">
            {mcp.remotes.map((remote, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-lg border p-3.5 text-sm">
                <div className="flex items-center gap-2">
                  <GlobeIcon className="size-4 text-muted-foreground" />
                  <span className="font-mono text-xs">{remote.url}</span>
                  <Badge variant="outline">{remote.transport_type.toUpperCase()}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Documentation / Body */}
      {mcp.body && (
        <Panel title="Documentation" contentClassName="p-5 overflow-y-auto max-h-[500px]">
          <div
            className="prose dark:prose-invert max-w-none text-sm leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderSkillBody(mcp.body) }}
          />
        </Panel>
      )}
    </div>
  );
}
