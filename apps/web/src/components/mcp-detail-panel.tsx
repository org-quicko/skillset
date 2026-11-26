import type { McpDetail } from "@in-org-quicko/skillset-shared";
import { FileJsonIcon, GlobeIcon, type LucideIcon, TerminalIcon } from "lucide-react";
import { type ReactNode, type SVGProps, useState } from "react";
import { AGENT_ICONS } from "@/components/agent-icons";
import { CopyableCode } from "@/components/copyable-code";
import { Panel } from "@/components/panel";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { mcpClientSnippets, type McpClient, type McpClientSnippet } from "@/lib/mcp-client-config";
import { renderSkillBody } from "@/lib/render-skill-body";

/** Each client's mark: the agent's own, or a file for the `.mcp.json` that several clients read. */
const CLIENT_ICONS: Record<McpClient, (props: SVGProps<SVGSVGElement>) => ReactNode> = {
  "mcp-json": FileJsonIcon,
  claude: AGENT_ICONS["claude-code"],
  codex: AGENT_ICONS.codex,
  cursor: AGENT_ICONS.cursor,
};

function ClientLabel({ snippet }: { snippet: McpClientSnippet }) {
  const Icon = CLIENT_ICONS[snippet.client];
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="size-3.5" />
      {snippet.label}
    </span>
  );
}

/**
 * How to add the server to each client, under a dropdown of the clients, as
 * on a Plugin's Installation panel. The choice is not kept in the URL: it is a
 * reading preference, not a view to share.
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
        <Select
          value={snippet.client}
          onValueChange={(value) => setClient(snippets.find((s) => s.client === value)?.client ?? client)}
        >
          <SelectTrigger size="sm" aria-label="Agent">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {snippets.map((s) => (
              <SelectItem key={s.client} value={s.client}>
                <ClientLabel snippet={s} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      <div className="flex flex-col gap-2">
        <span className="font-mono text-xs text-muted-foreground">{snippet.target}</span>
        <CopyableCode code={snippet.code} wrap={snippet.target === "Terminal"} />
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

/** Whether a Server entry is a package the client runs or a remote it connects to. */
function ServerKind({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {label}
    </span>
  );
}

/**
 * An MCP server's page body: how to add it to each client, how the server is
 * reached — a package the client runs or a remote endpoint it connects to — and
 * its README.
 *
 * @param mcp - The MCP server, as the Registry returns it.
 */
export function McpDetailPanel({ mcp }: { mcp: McpDetail }) {
  const packages = mcp.packages ?? [];
  const remotes = mcp.remotes ?? [];
  return (
    <div className="flex flex-col gap-4">
      <McpConfigPanel mcp={mcp} />

      {(packages.length > 0 || remotes.length > 0) && (
        <Panel title="Server">
          <div className="flex flex-col divide-y">
            {packages.map((pkg) => (
              <div key={`${pkg.registry_name}:${pkg.name}`} className="flex flex-col gap-3 py-4 text-sm first:pt-0 last:pb-0">
                <ServerKind icon={TerminalIcon} label="Package" />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 font-medium break-all">{pkg.name}</span>
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
            {remotes.map((remote) => (
              <div key={remote.url} className="flex flex-col gap-3 py-4 text-sm first:pt-0 last:pb-0">
                <ServerKind icon={GlobeIcon} label="Remote" />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 font-mono text-xs break-all">{remote.url}</span>
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
