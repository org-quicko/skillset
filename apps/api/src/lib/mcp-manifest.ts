/**
 * The static discovery document served at `GET /mcp`.
 *
 * @remarks
 * This describes the separate `@in-org-quicko/skillset-mcp` server — it is
 * not a live MCP endpoint. That server is deliberately stdio-only, run
 * locally by each Agent via `npx`, and holds no credential of its own
 * (ADR-0033); a remote HTTP transport was considered there and rejected. This
 * manifest exists so a caller can discover how to run that server and what
 * it offers without the Registry itself having to speak the MCP protocol
 * over HTTP. Kept in sync by hand with `apps/mcp/src/server.ts`, the same way
 * `docs/openapi.json` is kept in sync with the HTTP routes.
 *
 * `distribution.mcpb.url` is only meaningful when a build actually packed
 * `apps/mcp` (`deps.mcpbPath` in `app.ts`, ADR-0037) — this manifest names the
 * URL regardless, since it describes the deployment's capabilities rather
 * than this one process's; a deployment that never packed one answers that
 * URL with a 404, the same as any other route nothing registered.
 */
export const MCP_MANIFEST = {
  name: "skillset-mcp",
  title: "Skillset Skill Catalog",
  description: "MCP server for searching, installing, and publishing Skills on this Skillset Registry.",
  distribution: {
    npx: {
      package: "@in-org-quicko/skillset-mcp",
      command: "npx @in-org-quicko/skillset-mcp",
    },
    mcpb: {
      description: "A single-file bundle for a host that installs an MCP server that way, e.g. Claude Desktop.",
      url: "/mcp.mcpb",
    },
  },
  transport: "stdio",
  remote: false,
  tools: [
    { name: "search_skills", title: "Search Skillset Skills", description: "Search or list the Registry's Skill catalog. Read-only." },
    { name: "read_skill", title: "Read a Skill", description: "Read one Skill's SKILL.md and file list without installing it. Read-only." },
    { name: "install_skills", title: "Install Skills", description: "Install one or more Skills into the current project." },
    { name: "installed_skills", title: "List Installed Skills", description: "List this project's installed Skills and whether each is current, outdated, modified, or missing. Read-only." },
    { name: "update_skills", title: "Update Installed Skills", description: "Re-download installed Skills the Registry has moved on from." },
    { name: "remove_skills", title: "Remove Installed Skills", description: "Uninstall Skills from the current project." },
    { name: "publish_skill", title: "Publish a Skill", description: "Publish a Skill from the current project to the Registry. Requires a writer Token." },
  ],
} as const;
