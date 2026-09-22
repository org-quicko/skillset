import { DownloadIcon } from "lucide-react";
import { CopyableCode } from "@/components/copyable-code";
import { InfoRow } from "@/components/info-row";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** What this MCP server is published as — the name `npx` has to be given to reach it. */
const MCP_PACKAGE = "@in-org-quicko/skillset-mcp";

/**
 * `GET /mcp.mcpb` — a top-level route, not under `/api` (apps/api/src/app.ts, ADR-0037) — so this
 * is a plain path rather than `apiUrl(...)`.
 */
const MCPB_DOWNLOAD_PATH = "/mcp.mcpb";

/** The `mcp_servers.skill-registry` table Codex's `~/.codex/config.toml` needs. */
function codexConfig(registryUrl: string): string {
  return [
    "[mcp_servers.skill-registry]",
    'command = "npx"',
    `args = ["-y", "${MCP_PACKAGE}", "--registry", "${registryUrl}"]`,
  ].join("\n");
}

/** The `mcpServers` block every JSON-configured host (Claude Code, Cursor, Claude Desktop's own manual config) needs. */
function mcpServersConfig(registryUrl: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "skill-registry": {
          command: "npx",
          args: ["-y", MCP_PACKAGE, "--registry", registryUrl],
        },
      },
    },
    null,
    2,
  );
}

/**
 * The AI Assistants section: how to connect this Registry's MCP server
 * (`@in-org-quicko/skillset-mcp`) to a coding assistant, one tab per host.
 *
 * @remarks
 * Claude Desktop gets the `.mcpb` bundle rather than a config snippet — it is
 * the host `apps/mcp/README.md` documents as unable to run an arbitrary
 * command (ADR-0037). The other three hosts all run `npx` directly and read
 * the same `mcpServers` JSON shape, except Codex, which reads TOML.
 */
export function AiAssistantsCard() {
  const registryUrl = window.location.origin;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">AI Assistants</h2>
        <p className="max-w-2xl text-xs text-muted-foreground">
          Connect this Registry&apos;s MCP server to a coding assistant so it can search, install,
          and publish Skills directly.
        </p>
      </div>

      <Tabs defaultValue="claude-desktop">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="claude-desktop">Claude Desktop</TabsTrigger>
          <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
          <TabsTrigger value="codex">Codex</TabsTrigger>
          <TabsTrigger value="cursor">Cursor</TabsTrigger>
        </TabsList>

        <TabsContent value="claude-desktop" className="mt-4">
          <Panel contentClassName="p-0" className="bg-transparent">
            <InfoRow
              title="MCP Bundle"
              description="A single file that installs this Registry's MCP server into a host that can't run npx, like Claude Desktop's Extensions."
            >
              <Button variant="outline" size="sm" asChild>
                <a href={MCPB_DOWNLOAD_PATH} aria-label="Download MCP Bundle">
                  <DownloadIcon className="size-4" />
                  Download
                </a>
              </Button>
            </InfoRow>
          </Panel>
        </TabsContent>

        <TabsContent value="claude-code" className="mt-4">
          <Panel
            description="Add this to .mcp.json at the project root, or ~/.claude.json to install for every project."
            className="bg-transparent"
          >
            <CopyableCode code={mcpServersConfig(registryUrl)} />
          </Panel>
        </TabsContent>

        <TabsContent value="codex" className="mt-4">
          <Panel description="Add this to ~/.codex/config.toml." className="bg-transparent">
            <CopyableCode code={codexConfig(registryUrl)} />
          </Panel>
        </TabsContent>

        <TabsContent value="cursor" className="mt-4">
          <Panel
            description="Add this to ~/.cursor/mcp.json, or .cursor/mcp.json for one project only."
            className="bg-transparent"
          >
            <CopyableCode code={mcpServersConfig(registryUrl)} />
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
