import {
  deriveMcpServerKey,
  mcpResourceToConfig,
  type McpDetail,
  type McpServerConfigEntry,
} from "@in-org-quicko/skillset-shared";

export type McpClient = "mcp-json" | "claude" | "codex" | "cursor";

export interface McpClientSnippet {
  client: McpClient;
  /** The tab label. */
  label: string;
  /** Where the snippet goes: a file to paste it into, or "Terminal" for a command. */
  target: string;
  code: string;
  /** A caveat the reader needs before using the snippet. */
  note?: string;
}

/**
 * The server's config entry, with a placeholder for each required variable
 * that has no default — a pasted snippet should show what to fill in, where
 * the installer leaves it out.
 */
function entryWithPlaceholders(mcp: McpDetail): McpServerConfigEntry {
  const entry = mcpResourceToConfig(mcp);
  if (entry.url) return entry;
  const env = { ...entry.env };
  for (const variable of mcp.packages?.[0]?.environment_variables ?? []) {
    if (variable.required && !(variable.name in env)) env[variable.name] = `<YOUR_${variable.name}>`;
  }
  return Object.keys(env).length > 0 ? { ...entry, env } : entry;
}

/** Quotes a shell word only when it needs it, so the common command stays readable. */
function shellQuote(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

/** A TOML key, quoted unless it is a bare key. */
function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function tomlInlineTable(record: Record<string, string>): string {
  const pairs = Object.entries(record).map(([key, value]) => `${tomlKey(key)} = ${JSON.stringify(value)}`);
  return `{ ${pairs.join(", ")} }`;
}

function claudeCommand(key: string, entry: McpServerConfigEntry, transport: string): string {
  if (entry.url) {
    const headers = Object.entries(entry.headers ?? {}).map(
      ([name, value]) => ` --header ${shellQuote(`${name}: ${value}`)}`,
    );
    return `claude mcp add --transport ${transport} ${shellQuote(key)} ${shellQuote(entry.url)}${headers.join("")}`;
  }
  const env = Object.entries(entry.env ?? {}).map(([name, value]) => ` -e ${shellQuote(`${name}=${value}`)}`);
  const run = [entry.command ?? "", ...(entry.args ?? [])].map(shellQuote).join(" ");
  return `claude mcp add ${shellQuote(key)}${env.join("")} -- ${run}`;
}

function codexToml(key: string, entry: McpServerConfigEntry): string {
  const lines = [`[mcp_servers.${tomlKey(key)}]`];
  if (entry.url) {
    lines.push(`url = ${JSON.stringify(entry.url)}`);
    if (entry.headers) lines.push(`http_headers = ${tomlInlineTable(entry.headers)}`);
  } else {
    lines.push(`command = ${JSON.stringify(entry.command ?? "")}`);
    lines.push(`args = [${(entry.args ?? []).map((arg) => JSON.stringify(arg)).join(", ")}]`);
    if (entry.env) lines.push(`env = ${tomlInlineTable(entry.env)}`);
  }
  return lines.join("\n");
}

/**
 * How to add an MCP server to each supported client: a project `.mcp.json`,
 * Claude Code's CLI, Codex's `config.toml`, and Cursor's `mcp.json`.
 *
 * @param mcp - The MCP server, as the Registry returns it.
 * @returns One snippet per client, in tab order.
 * @throws Error when the server has neither a package nor a remote — the
 * Registry refuses to publish one, so this only fires on bad data.
 * @example
 * const [mcpJson, claude, codex, cursor] = mcpClientSnippets(mcp);
 */
export function mcpClientSnippets(mcp: McpDetail): McpClientSnippet[] {
  const key = deriveMcpServerKey(mcp.name);
  const entry = entryWithPlaceholders(mcp);
  const transport = mcp.remotes?.[0]?.transport_type ?? "http";
  // Claude Code reads a remote server's transport from `type`; without it the entry is taken as stdio.
  const mcpJsonEntry = entry.url ? { type: transport, ...entry } : entry;
  const json = (value: McpServerConfigEntry) => JSON.stringify({ mcpServers: { [key]: value } }, null, 2);

  return [
    { client: "mcp-json", label: ".mcp.json", target: ".mcp.json", code: json(mcpJsonEntry) },
    { client: "claude", label: "Claude Code", target: "Terminal", code: claudeCommand(key, entry, transport) },
    {
      client: "codex",
      label: "Codex",
      target: "~/.codex/config.toml",
      code: codexToml(key, entry),
      note:
        entry.url && transport === "sse"
          ? "Codex connects to remote servers over streamable HTTP, not SSE. This server may not connect."
          : undefined,
    },
    { client: "cursor", label: "Cursor", target: ".cursor/mcp.json", code: json(entry) },
  ];
}
