import type { McpDetail } from "@in-org-quicko/skillset-shared";
import { GlobeIcon, TerminalIcon } from "lucide-react";
import { useState } from "react";
import { CopyableCode } from "@/components/copyable-code";
import { Panel } from "@/components/panel";
import { PanelTabs } from "@/components/panel-tabs";
import { Badge } from "@/components/ui/badge";
import { mcpClientSnippets, type McpClient } from "@/lib/mcp-client-config";
import { renderSkillBody } from "@/lib/render-skill-body";

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
        <PanelTabs
          tabs={snippets.map((s) => ({ id: s.client, label: s.label }))}
          value={snippet.client}
          onChange={setClient}
        />
      }
    >
      <div className="flex flex-col gap-2">
        <span className="font-mono text-xs text-muted-foreground">{snippet.target}</span>
        <CopyableCode code={snippet.code} />
        {snippet.note && <p className="text-xs text-pretty text-muted-foreground">{snippet.note}</p>}
      </div>
    </Panel>
  );
}

/** A name in a mono column with its description beside it, wrapping under it on a narrow screen. */
function NamedValue({ name, required, description }: { name: string; required?: boolean; description?: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs font-medium break-all">{name}</span>
        {required && (
          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
            Required
          </Badge>
        )}
      </div>
      {description && <span className="text-xs text-pretty text-muted-foreground">{description}</span>}
    </div>
  );
}

/**
 * An MCP server's page body: how to add it to each client, the package it runs
 * or the endpoint it connects to, and its README.
 *
 * @param mcp - The MCP server, as the Registry returns it.
 */
export function McpDetailPanel({ mcp }: { mcp: McpDetail }) {
  return (
    <div className="flex flex-col gap-4">
      <McpConfigPanel mcp={mcp} />

      {mcp.packages && mcp.packages.length > 0 && (
        <Panel title="Package">
          <div className="flex flex-col gap-3">
            {mcp.packages.map((pkg) => (
              <div key={`${pkg.registry_name}:${pkg.name}`} className="flex flex-col gap-3 rounded-lg border p-3.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <TerminalIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 font-medium break-all">{pkg.name}</span>
                  </span>
                  <Badge variant="outline">{pkg.registry_name}</Badge>
                  {pkg.version && <Badge variant="secondary">{pkg.version}</Badge>}
                </div>

                {pkg.environment_variables && pkg.environment_variables.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <span className="text-xs text-muted-foreground">Environment variables</span>
                    {pkg.environment_variables.map((variable) => (
                      <NamedValue
                        key={variable.name}
                        name={variable.name}
                        required={variable.required}
                        description={variable.description}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {mcp.remotes && mcp.remotes.length > 0 && (
        <Panel title="Remote connection">
          <div className="flex flex-col gap-3">
            {mcp.remotes.map((remote) => (
              <div key={remote.url} className="flex flex-col gap-3 rounded-lg border p-3.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <GlobeIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 font-mono text-xs break-all">{remote.url}</span>
                  </span>
                  <Badge variant="outline">{remote.transport_type.toUpperCase()}</Badge>
                </div>
                {/* Headers usually carry the credential a reader has to supply, so they are shown, not only pasted. */}
                {remote.headers && Object.keys(remote.headers).length > 0 && (
                  <div className="flex flex-col gap-2">
                    <span className="text-xs text-muted-foreground">Headers</span>
                    {Object.entries(remote.headers).map(([name, value]) => (
                      <NamedValue key={name} name={name} description={value} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {mcp.body && (
        <Panel title="README">
          <div
            className="prose max-w-none text-sm leading-relaxed dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: renderSkillBody(mcp.body) }}
          />
        </Panel>
      )}
    </div>
  );
}
