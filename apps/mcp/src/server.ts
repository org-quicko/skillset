import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import { z } from "zod";
import { ArtifactManifestSchema, PLUGIN_AGENT_IDS, type AgentDetection } from "@in-org-quicko/skillset-shared";
import { runCommand, type RunCommand } from "@in-org-quicko/skillset-installer";
import type { McpConfig } from "./config.js";
import { resolveAgent } from "./detect-agent.js";
import type { Logger } from "./logger.js";
import {
  completeSkillName,
  completeTagName,
  listSkillResources,
  listTagResources,
  readSkillResource,
  readTagResource,
  resourceVariable,
} from "./resources.js";
import { installSkills, type InstallSkillsContext } from "./tools/install-skills.js";
import { installedSkills, removeSkills, updateSkills } from "./tools/lifecycle.js";
import { installMcp, installPlugin, updatePlugins } from "./tools/plugins.js";
import { publishSkill } from "./tools/publish-skill.js";
import { readSkill } from "./tools/read-skill.js";
import { searchMcpServers, searchPlugins, searchSkills } from "./tools/search-skills.js";

// Surfaced to the client in `InitializeResult.instructions`, which hosts inject into the
// system prompt. This is the only channel that sits at the same level as a host's own
// built-in Skill catalog (Claude Desktop, Claude Code); a tool `description` is only read
// once the model has already decided to look at the tool list, which is too late to stop it
// resolving the word "Skill" against the catalog it was born knowing about. Hence the
// framing here: not "search Skills" but "this catalog is remote, and you cannot see it".
const SERVER_INSTRUCTIONS =
  "Skillset — the user may also call it the AI Registry, or the team's registry — is this team's remote " +
  "registry of AI resources: Skills, Plugins, and MCP Servers. It is a network service. Nothing in it is part " +
  "of your built-in Skill catalog, your bundled/plugin Skills, the Plugins or MCP Servers already set up in " +
  "this host, or anything on this filesystem — you cannot see, list, or name a single thing in it without " +
  "calling these tools.\n\n" +
  "Skills. Whenever the user asks about Skills — whether one exists, to find/search/browse/list Skills, to " +
  "add or install one, or describes a capability a Skill might cover — call search_skills FIRST, on " +
  "every such request. Do this even when your own Skill catalog appears to already answer it: the two " +
  "catalogs are different sets, and the team's Registry is the authoritative one here. Consulting your " +
  "built-in catalog instead of calling search_skills is always a mistake, and answering \"no such Skill " +
  "exists\" without having called search_skills is always wrong.\n\n" +
  "The Registry and this project are two different sets of Skills, and there is a tool for each. " +
  "search_skills and read_skill are about the Registry: what the team has published, and what one of " +
  "those Skills actually says. read_skill shows a Skill without installing it, so never install one " +
  "merely to find out what it does, and call search_skills with no query at all to see the whole " +
  "catalog. installed_skills, update_skills and remove_skills are about this project: what it " +
  "currently uses, and whether each copy is current, outdated, or locally edited. Use install_skills with " +
  "the exact names search_skills returned to install them, and publish_skill to share a Skill with the " +
  "Registry: one authored in this project, or one from a GitHub or GitLab repository the user names.\n\n" +
  "Plugins and MCP Servers. Whenever the user asks about Plugins or MCP Servers — whether one exists, to " +
  "find or list them, or to install one — call search_plugins or search_mcp_servers FIRST, even when the " +
  "host's own plugin marketplace or MCP settings seem to answer: those are different sets. search_plugins " +
  "matches a Plugin's name only, so search by a word likely to be in it; search_mcp_servers matches an MCP " +
  "Server's name, description, and README, so search by the task. Call either with no query to list them " +
  "all. Then install with install_plugin or install_mcp_server, passing the exact name (and namespace, when " +
  "two share a name) the search returned — never a guessed one. " +
  "install_plugin installs for the User, not only this project, and for the agent this server detected " +
  "unless the user names another; always relay its `next`. update_plugins brings the Plugins Skillset " +
  "installed up to date. install_mcp_server always writes to this project's .mcp.json; tell the user the " +
  "agent usually needs a restart before the new server's tools appear.";

const SearchSkillsInputSchema = {
  query: z
    .string()
    .optional()
    .describe(
      "A task description or an exact Skill name to find in the shared Skillset catalog. Examples: `adapter`, " +
        "`write-adapters`, `review pull requests`, or `write changelogs`. OMIT THIS to list the whole catalog, " +
        "which is how you answer `what Skills do we have?`.",
    ),
  tag: z
    .string()
    .optional()
    .describe("Optional Tag NAME to narrow the search, e.g. `testing`. Not an id — names are what the Registry shows."),
  limit: z.number().int().positive().optional().describe("Optional maximum number of matching Skills to return per page."),
  cursor: z
    .string()
    .optional()
    .describe(
      "Opaque pagination token from a previous search_skills call's `next_cursor`. Omit for the first page — " +
        "past the first page, a catalog larger than `limit` is otherwise unreachable.",
    ),
};

/** search_plugins' and search_mcp_servers' inputs: search_skills' own, described for their Kind. */
function searchResourcesInputSchema(what: string, query: string) {
  return {
    query: z
      .string()
      .optional()
      .describe(`${query} OMIT THIS to list every ${what} in the Registry.`),
    tag: SearchSkillsInputSchema.tag,
    limit: z.number().int().positive().optional().describe(`Optional maximum number of ${what}s to return per page.`),
    cursor: SearchSkillsInputSchema.cursor,
  };
}

const SearchPluginsInputSchema = searchResourcesInputSchema(
  "Plugin",
  "Words from the Plugin's name, e.g. `review` or `code-review-suite`. Only names are searched, not descriptions.",
);

const SearchMcpServersInputSchema = searchResourcesInputSchema(
  "MCP Server",
  "A task or an exact name, e.g. `weather`, `query a postgres database`, or `io.github.acme/search`. Matched " +
    "against each MCP Server's name, description, and README.",
);

const ReadSkillInputSchema = {
  name: z.string().min(1).describe("The Skill's name, exactly as search_skills reported it."),
};

const InstalledSkillsInputSchema = {};

const UpdateSkillsInputSchema = {
  names: z
    .array(z.string().min(1))
    .optional()
    .describe("The installed Skills to update. Omit to update every one this project has fallen behind on."),
  force: z
    .boolean()
    .optional()
    .describe(
      "Update a Skill even though its installed copy has local edits, discarding them. Only set this when the " +
        "User has been told about the edits and asked for them to be discarded.",
    ),
};

const RemoveSkillsInputSchema = {
  names: z.array(z.string().min(1)).min(1).describe("The installed Skills to uninstall from this project."),
};

const PublishSkillInputSchema = {
  path: z
    .string()
    .optional()
    .describe(
      "Directory holding the Skill's own SKILL.md, relative to the project root. Defaults to the project root " +
        "itself. Must be the Skill's own directory, not a folder containing several Skills. Omit when passing `url`.",
    ),
  url: z
    .string()
    .optional()
    .describe(
      "A GitHub or GitLab URL to publish from instead of this project — a repository, or a folder in one. " +
        "Cloned with the User's own git credentials, so private repositories they can clone work. Requires `name`.",
    ),
  name: z
    .string()
    .min(1)
    .optional()
    .describe(
      "With `url`, and required with it: which Skill to publish, by the `name` in its SKILL.md frontmatter. " +
        "If it matches none, the error lists every Skill the repository holds.",
    ),
};

const InstallSkillsInputSchema = {
  names: z
    .array(z.string().min(1))
    .min(1)
    .describe("The Skill names to install, exactly as the Registry reports them (see search_skills)."),
  overwrite: z
    .boolean()
    .optional()
    .describe(
      "Replace an already-installed Skill completely. Only set this when the User has explicitly asked to update or replace it — never on a routine install.",
    ),
};

const PluginAgentInput = z
  .enum(PLUGIN_AGENT_IDS)
  .optional();

const InstallPluginInputSchema = {
  name: z.string().min(1).describe("The Plugin's name in the Registry, exactly as the user or the Registry gave it."),
  namespace: z
    .string()
    .min(1)
    .optional()
    .describe("Which party named the Plugin. Only needed when a bare name matches more than one; the error then names them."),
  agent: PluginAgentInput.describe(
    "Which coding agent to install the Plugin for. Omit to use the agent this server detected, or the only agent the " +
      "Plugin supports. Pass it when the user names a different agent than the one running.",
  ),
};

const UpdatePluginsInputSchema = {
  name: z.string().min(1).optional().describe("The Plugin to update. Omit to update every Plugin Skillset installed."),
  namespace: z.string().min(1).optional().describe("Only the Plugin from this Namespace."),
  agent: PluginAgentInput.describe("Only the Plugin's install for this agent."),
  force: z.boolean().optional().describe("Reinstall even when the Registry has nothing newer."),
};

const InstallMcpServerInputSchema = {
  name: z.string().min(1).describe("The MCP Server's name in the Registry, e.g. `io.github.acme/search`."),
  namespace: z
    .string()
    .min(1)
    .optional()
    .describe("Which party named the MCP Server. Only needed when a bare name matches more than one."),
  force: z
    .boolean()
    .optional()
    .describe(
      "Replace a server already configured under the same key in .mcp.json. Only set this when the user has asked " +
        "to replace it.",
    ),
};

/**
 * Every `outputSchema` below (spec, "Protocol hygiene"): the exact shape each tool's
 * `structuredContent` returns, so a client can validate it instead of only having the loose
 * `content[0].text` JSON to trust. Named `*OutputSchema` and kept next to the matching
 * `*InputSchema` above, one per tool, rather than colocated with each tool's own module — a
 * client reads a tool's input and output shape together, and this is the one place both are
 * declared for every tool at once.
 */

const SkillSummaryOutputSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  updated_at: z.string(),
  installs: z.number(),
  allowed_tools: z.string().nullable(),
  source: z.string(),
});

const SearchSkillsOutputSchema = {
  results: z.array(SkillSummaryOutputSchema),
  total: z.number(),
  truncated: z.boolean(),
  page: z.number(),
  page_size: z.number(),
  next_cursor: z.string().nullable(),
};

const SearchResourcesOutputSchema = {
  results: z.array(
    z.object({
      name: z.string(),
      namespace: z.string(),
      description: z.string(),
      tags: z.array(z.string()),
      updated_at: z.string(),
      installs: z.number(),
      source: z.string(),
    }),
  ),
  total: z.number(),
  truncated: z.boolean(),
  page: z.number(),
  page_size: z.number(),
  next_cursor: z.string().nullable(),
};

const AgentDetectionOutputSchema = z.object({
  agentId: z.string().nullable(),
  step: z.enum(["override", "client-identity", "environment", "project-directory", "canonical-fallback"]),
});

const LinkResultOutputSchema = z.union([
  z.object({ kind: z.literal("canonical") }),
  z.object({ kind: z.literal("symlink"), path: z.string() }),
  z.object({ kind: z.literal("copy"), path: z.string(), reason: z.enum(["requested", "symlink-failed"]) }),
]);

const InstallSkillOutcomeOutputSchema = z.discriminatedUnion("status", [
  z.object({
    name: z.string(),
    status: z.literal("installed"),
    skillDirectory: z.string(),
    link: LinkResultOutputSchema,
    alsoServes: z.array(z.string()),
    skillMdBody: z.string(),
    note: z.string(),
  }),
  z.object({
    name: z.string(),
    status: z.literal("fallback"),
    artifactLocation: z.string(),
    manifest: ArtifactManifestSchema,
    intendedDirectory: z.string(),
    skillMdBody: z.string(),
  }),
  z.object({
    name: z.string(),
    status: z.literal("refused"),
    existing: z.string(),
    installed: z.enum(["current", "outdated", "modified", "untracked"]),
  }),
  z.object({ name: z.string(), status: z.literal("error"), message: z.string() }),
]);

const InstallSkillsOutputSchema = {
  detection: AgentDetectionOutputSchema,
  outcomes: z.array(InstallSkillOutcomeOutputSchema),
};

const PublishSkillOutputSchema = {
  name: z.string(),
  id: z.string(),
  published_at: z.string(),
  source: z.string().nullable(),
  files: z.array(z.object({ path: z.string(), size: z.number() })),
  total_bytes: z.number(),
};

const ReadSkillOutputSchema = {
  skill: z.object({
    name: z.string(),
    description: z.string(),
    body: z.string(),
    tags: z.array(z.string()),
    updated_at: z.string(),
    installs: z.number(),
    license: z.string().nullable(),
    compatibility: z.string().nullable(),
    allowed_tools: z.string().nullable(),
    source: z.string(),
    files: z.array(z.object({ path: z.string(), size: z.number() })),
  }),
};

const InstalledSkillsOutputSchema = {
  skills: z.array(
    z.object({
      name: z.string(),
      status: z.enum(["current", "outdated", "modified", "missing"]),
      directory: z.string(),
      installed_at: z.string(),
      registry_updated_at: z.string().nullable(),
    }),
  ),
};

const RemoveSkillsOutputSchema = {
  outcomes: z.array(
    z.discriminatedUnion("status", [
      z.object({
        name: z.string(),
        status: z.literal("removed"),
        skillDirectory: z.string().nullable(),
        link: z.string().nullable(),
      }),
      z.object({ name: z.string(), status: z.literal("not-installed") }),
      z.object({ name: z.string(), status: z.literal("error"), message: z.string() }),
    ]),
  ),
};

const PluginAgentOutputSchema = z.enum(PLUGIN_AGENT_IDS);

const InstallPluginOutputSchema = {
  name: z.string(),
  namespace: z.string(),
  agent: PluginAgentOutputSchema,
  supported_agents: z.array(PluginAgentOutputSchema),
  via: z.enum(["hosted", "local"]).nullable(),
  path: z.string().nullable(),
  commands: z.array(z.string()),
  next: z.string().nullable(),
};

const UpdatePluginsOutputSchema = {
  outcomes: z.array(
    z.discriminatedUnion("status", [
      z.object({ name: z.string(), namespace: z.string(), agent: PluginAgentOutputSchema, status: z.literal("current"), revision: z.string() }),
      z.object({
        name: z.string(),
        namespace: z.string(),
        agent: PluginAgentOutputSchema,
        status: z.literal("updated"),
        from: z.string(),
        to: z.string(),
        next: z.string().optional(),
      }),
      z.object({ name: z.string(), namespace: z.string(), agent: PluginAgentOutputSchema, status: z.literal("failed"), message: z.string() }),
    ]),
  ),
};

const InstallMcpServerOutputSchema = {
  server_key: z.string(),
  config_path: z.string(),
  overwritten: z.boolean(),
  config: z.object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
};

/**
 * Builds this server's `McpServer` instance and registers its tools.
 *
 * @param config - The resolved `--registry`/`--scope`/`--agent`/`--log-level`/`--token` configuration.
 * @param fetchImpl - The `fetch` implementation every tool sends its requests with.
 * @param logger - Where to write diagnostics; never stdout (see {@link Logger}).
 * @param ctx - The project root, environment, and home directory `install_skills` and
 * `publish_skill` resolve paths against, and that Agent detection reads its signals from.
 * @param run - Runs an agent's own CLI (`claude`, `codex`) for `install_plugin` and `update_plugins`.
 * @returns An `McpServer`, ready to `connect()` to a transport.
 *
 * @remarks
 * This is the one part of the SDK wiring not covered by a unit test at the same rigor as
 * {@link searchSkills}, {@link installSkills}, and `publishSkill` themselves — the acceptance bar
 * here is that each *handler* is a plain, independently-testable function, which their own
 * test files already cover. `publish_skill` is the one tool that writes to the Registry, and
 * the one this server needs a Token for at all (ADR-0035) — every other tool still sends no
 * `authorization` header (ADR-0013). The Agent is detected lazily on the first `install_skills`
 * call — the client's identity is not known until after `initialize` — and cached for the
 * rest of the connection.
 *
 * The server also advertises {@link SERVER_INSTRUCTIONS}, which is what keeps a host from
 * answering a Skill question out of its own built-in catalog instead of calling
 * `search_skills` — see that constant for why a tool `description` cannot do that job alone.
 *
 * Every tool carries an `outputSchema` matching its `structuredContent`, so a client can
 * validate a result rather than only trust the loose JSON in `content[0].text`. Beyond the
 * tools, two MCP `resources` templates are registered directly against
 * {@link "./resources.js"}'s pure functions — `skillset://skills/{name}` (one Skill's
 * `SKILL.md`, completing `name` against the catalog) and `skillset://tags/{tag}` (the Skills
 * under one Tag, completing `tag`) — so a host can browse and attach either without a tool
 * call, and so `name`/`tag` argument values are discoverable through `completion/complete`
 * rather than guessed (MCP completions attach only to resource template variables and
 * prompt arguments, never to a tool's own `inputSchema`, which is why this lives here and
 * not as a `search_skills` argument completion).
 *
 * @example
 * ```ts
 * const server = createServer(config, fetch, createLogger(config.logLevel), ctx);
 * await server.connect(new StdioServerTransport());
 * ```
 */
export function createServer(
  config: McpConfig,
  fetchImpl: typeof fetch,
  logger: Logger,
  ctx: InstallSkillsContext,
  run: RunCommand = runCommand,
): McpServer {
  const server = new McpServer(
    { name: "skillset-mcp", version: "0.0.0", title: "Skillset Skill Catalog" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  // Resolved once, lazily: the client's identity is only known after the `initialize`
  // handshake, and no tool that needs an Agent — `install_skills`, `update_skills`,
  // `remove_skills` — runs before then.
  let detection: AgentDetection | undefined;
  const resolveDetection = (): AgentDetection => {
    if (!detection) {
      detection = resolveAgent(config, server.server.getClientVersion()?.name, ctx);
      logger.info(`agent detected: ${detection.agentId ?? "none (canonical fallback)"} (via ${detection.step})`);
    }
    return detection;
  };

  server.registerTool(
    "search_skills",
    {
      title: "Search Skillset Skills",
      description:
        "Search this team's REMOTE Skill Registry over the network. Its Skills are a different set from your " +
        "built-in Skill catalog and from any Skill on this filesystem, and none of them are visible to you until " +
        "this tool returns them. ALWAYS call this tool when the user asks whether a Skill exists, asks to " +
        "find/search/locate/list a Skill, mentions Skillset or the Registry, or describes a capability that may " +
        "have a Skill — including when your own catalog looks like it already answers, because it is a different " +
        "catalog. Never substitute your built-in Skill catalog for this search, and never report that no Skill " +
        "exists without having called this tool. Search by the user's task or exact Skill name, such as `adapter`, " +
        "`write-adapters`, `review pull requests`, or `write changelogs`. Call this before calling install_skills so " +
        "you have the exact Registry name. Read-only; installs and modifies nothing. Returns matching Skill names " +
        "and descriptions, with optional tag and result-limit filters, and a `next_cursor` to page past the cap " +
        "when the catalog holds more than fit in one page. Each result also carries `allowed_tools` — what that " +
        "Skill claims the right to reach once loaded. Say what it names before installing a Skill that sets it: " +
        "installing is what grants it.",
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: SearchSkillsInputSchema,
      outputSchema: SearchSkillsOutputSchema,
    },
    async ({ query, tag, limit, cursor }) => {
      logger.debug(`search_skills query=${query} tag=${tag ?? ""} limit=${limit ?? ""} cursor=${cursor ?? ""}`);
      const results = await searchSkills(fetchImpl, config.registry, { query, tag, limit, cursor });
      return {
        content: [{ type: "text", text: JSON.stringify(results) }],
        structuredContent: { ...results },
      };
    },
  );

  server.registerTool(
    "install_skills",
    {
      title: "Install Skills",
      description:
        "Install one or more Agent Skills from your team's remote Skill Registry into this project, writing each " +
        "into the directory your Agent loads Skills from (detected automatically — you don't supply a path or an " +
        "agent name). Use this when the user asks to add, install, or set up a Skill; pass the exact Skill names " +
        "returned by search_skills. Installs several at once, and one bad name doesn't stop the rest. Returns the " +
        "detected Agent, where each Skill was written, and each Skill's SKILL.md so it's usable immediately. Set " +
        "overwrite only when the user has explicitly asked to update or replace a Skill that's already installed. " +
        "A Skill that is already installed comes back as `refused` with an `installed` field saying how that copy " +
        "stands: `current` means it already matches the Registry and there is nothing to do; `outdated` means the " +
        "Registry has moved on, so update_skills is the right call; `modified` or `untracked` means overwriting " +
        "may discard someone's edits — say so and ask before retrying with overwrite.",
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
      inputSchema: InstallSkillsInputSchema,
      outputSchema: InstallSkillsOutputSchema,
    },
    async ({ names, overwrite }) => {
      logger.debug(`install_skills names=${names.join(",")} overwrite=${overwrite ?? false}`);
      const result = await installSkills(
        { fetchImpl, registry: config.registry, ctx, scope: config.scope, detection: resolveDetection(), overwrite: overwrite ?? false },
        names,
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: { ...result } };
    },
  );

  server.registerTool(
    "publish_skill",
    {
      title: "Publish a Skill",
      description:
        "Publish a Skill to your team's shared Skillset Registry, so install_skills can install it for everyone " +
        "else. Use this when the user asks to publish, share, or push a Skill to the Registry. Either pass `path` " +
        "to the directory in this project holding that Skill's own SKILL.md (defaults to the project root), or " +
        "pass `url` — a GitHub or GitLab repository or folder — together with `name`, the Skill's name from its " +
        "SKILL.md, to publish it straight from that repository. Only publish a repository the user named. " +
        "Republishing an existing name overwrites it completely — there is no versioning. Requires a " +
        "writer Token to be configured on this server (--token or SKILLSET_TOKEN); if none is configured, this " +
        "tool fails naming that as the reason rather than attempting the request.",
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      inputSchema: PublishSkillInputSchema,
      outputSchema: PublishSkillOutputSchema,
    },
    async ({ path, url, name }) => {
      logger.debug(`publish_skill ${url ? `url=${url} name=${name ?? "(none)"}` : `path=${path ?? "(project root)"}`}`);
      // Returned as an explicit `isError` result rather than thrown: a thrown Error still
      // reaches the caller as one (the SDK wraps it), but the message below is written for
      // the User, not the Agent — "restart this server" is an instruction only a person
      // sitting at this machine can act on, and an isError result is where that distinction
      // between "tell the Agent" and "tell the User through the Agent" belongs.
      if (!config.token) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "publish_skill needs a writer Token, and none is configured on this server. Tell the User to set " +
                "--token <token> or the SKILLSET_TOKEN environment variable and restart this MCP server — that is " +
                "not something this tool call can do on its own.",
            },
          ],
        };
      }
      try {
        const result = await publishSkill(
          { fetchImpl, registry: config.registry, token: config.token, cwd: ctx.cwd, env: ctx.env },
          { path, url, name },
        );
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: { ...result } };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        };
      }
    },
  );

  server.registerTool(
    "read_skill",
    {
      title: "Read a Skill",
      description:
        "Read one Skill from the Registry WITHOUT installing it: its full SKILL.md body, its Tags, when it was " +
        "last updated, and every file it ships. Use this whenever you need to know what a Skill actually does, " +
        "how it works, or whether it fits - reviewing a candidate before installing, answering a question about " +
        "a Skill, or comparing two. Never call install_skills merely to find out what a Skill contains; that " +
        "writes to the user's project, and this does not. Pass the exact name search_skills reported. Read-only.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: ReadSkillInputSchema,
      outputSchema: ReadSkillOutputSchema,
    },
    async ({ name }) => {
      logger.debug(`read_skill name=${name}`);
      const skill = await readSkill(fetchImpl, config.registry, name);
      return { content: [{ type: "text", text: JSON.stringify(skill) }], structuredContent: { skill } };
    },
  );

  server.registerTool(
    "installed_skills",
    {
      title: "List Installed Skills",
      description:
        "List the Skills installed in THIS project and how each stands: `current`, `outdated` (the Registry has " +
        "a newer version), `modified` (someone edited the installed copy) or `missing` (its files are gone). " +
        "This is the local inventory, not the Registry's catalog - use search_skills for that. Call this before " +
        "update_skills or remove_skills so you act on what is actually here, and whenever the user asks what " +
        "Skills this project uses or whether anything is out of date. Read-only.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: InstalledSkillsInputSchema,
      outputSchema: InstalledSkillsOutputSchema,
    },
    async () => {
      logger.debug("installed_skills");
      const skills = await installedSkills({ fetchImpl, registry: config.registry, ctx, scope: config.scope });
      return { content: [{ type: "text", text: JSON.stringify(skills) }], structuredContent: { skills } };
    },
  );

  server.registerTool(
    "update_skills",
    {
      title: "Update Installed Skills",
      description:
        "Re-download installed Skills the Registry has moved on from, replacing this project's copies. Omit " +
        "`names` to update everything that has fallen behind. A Skill whose installed copy has local edits is " +
        "SKIPPED and reported as refused, because an update cannot be undone - tell the user what was skipped " +
        "and only pass `force` if they ask for those edits to be discarded. Use this when the user asks to " +
        "update, refresh, or upgrade Skills.",
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
      inputSchema: UpdateSkillsInputSchema,
      outputSchema: InstallSkillsOutputSchema,
    },
    async ({ names, force }) => {
      logger.debug(`update_skills names=${names?.join(",") ?? "(all)"} force=${force ?? false}`);
      const result = await updateSkills(
        { fetchImpl, registry: config.registry, ctx, scope: config.scope, detection: resolveDetection() },
        { names, force },
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: { ...result } };
    },
  );

  server.registerTool(
    "remove_skills",
    {
      title: "Remove Installed Skills",
      description:
        "Uninstall Skills from this project: their files, this Agent's link to each, and their lockfile entries. " +
        "Nothing is removed from the Registry - the team keeps the Skill, this project stops using it. Use this " +
        "when the user asks to remove, uninstall, or stop using a Skill. Removing something that is not " +
        "installed is harmless and reported as such.",
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: RemoveSkillsInputSchema,
      outputSchema: RemoveSkillsOutputSchema,
    },
    async ({ names }) => {
      logger.debug(`remove_skills names=${names.join(",")}`);
      const outcomes = await removeSkills({ ctx, scope: config.scope, agentId: resolveDetection().agentId }, names);
      return { content: [{ type: "text", text: JSON.stringify(outcomes) }], structuredContent: { outcomes } };
    },
  );

  const pluginDeps = { fetchImpl, registry: config.registry, ctx, run };

  server.registerTool(
    "search_plugins",
    {
      title: "Search Skillset Plugins",
      description:
        "Search this team's REMOTE Registry for Plugins — a different set from the host's own plugin marketplace " +
        "and from anything already installed. ALWAYS call this when the user asks whether a Plugin exists, asks to " +
        "find or list Plugins, or asks to install one, before install_plugin, so you pass the exact Registry name. " +
        "Matches the Plugin's NAME only, typos forgiven; omit `query` to list every Plugin. Read-only. Returns each " +
        "Plugin's name, namespace, description, Tags, and installs, and a `next_cursor` to page past the cap.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: SearchPluginsInputSchema,
      outputSchema: SearchResourcesOutputSchema,
    },
    async ({ query, tag, limit, cursor }) => {
      logger.debug(`search_plugins query=${query ?? ""} tag=${tag ?? ""} limit=${limit ?? ""} cursor=${cursor ?? ""}`);
      const results = await searchPlugins(fetchImpl, config.registry, { query, tag, limit, cursor });
      return { content: [{ type: "text", text: JSON.stringify(results) }], structuredContent: { ...results } };
    },
  );

  server.registerTool(
    "search_mcp_servers",
    {
      title: "Search Skillset MCP Servers",
      description:
        "Search this team's REMOTE Registry for MCP Servers — a different set from the servers already configured " +
        "in this host. ALWAYS call this when the user asks whether an MCP Server exists for something, asks to find " +
        "or list them, or asks to install one, before install_mcp_server, so you pass the exact Registry name. " +
        "Matches the server's name, description, and README, so search by the user's task; omit `query` to list " +
        "every MCP Server. Read-only. Returns each server's name, namespace, description, Tags, and installs, and " +
        "a `next_cursor` to page past the cap.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: SearchMcpServersInputSchema,
      outputSchema: SearchResourcesOutputSchema,
    },
    async ({ query, tag, limit, cursor }) => {
      logger.debug(`search_mcp_servers query=${query ?? ""} tag=${tag ?? ""} limit=${limit ?? ""} cursor=${cursor ?? ""}`);
      const results = await searchMcpServers(fetchImpl, config.registry, { query, tag, limit, cursor });
      return { content: [{ type: "text", text: JSON.stringify(results) }], structuredContent: { ...results } };
    },
  );

  server.registerTool(
    "install_plugin",
    {
      title: "Install a Plugin",
      description:
        "Install a Plugin from your team's Skillset Registry for a coding agent (Claude Code, Cursor, or Codex). Use " +
        "this when the user asks to install or add a Plugin; pass the exact name search_plugins returned. A Plugin installs for the User, not just this " +
        "project: Claude Code through `claude plugin install`, Cursor into ~/.cursor/plugins/local, Codex through " +
        "`codex plugin add`. Omit `agent` to install for the agent this server detected; the result lists every agent " +
        "the Plugin supports. Returns the commands that were run and `next`, what the user still has to do (such as " +
        "restart the agent) — always tell them `next` when it is set. Installing one already installed updates it.",
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: InstallPluginInputSchema,
      outputSchema: InstallPluginOutputSchema,
    },
    async ({ name, namespace, agent }) => {
      logger.debug(`install_plugin name=${name} namespace=${namespace ?? ""} agent=${agent ?? ""}`);
      const result = await installPlugin(pluginDeps, { name, namespace, agent }, resolveDetection().agentId);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: { ...result } };
    },
  );

  server.registerTool(
    "update_plugins",
    {
      title: "Update Installed Plugins",
      description:
        "Update Plugins Skillset installed (through install_plugin or `skillset plugins install`) to what the " +
        "Registry has now. Omit `name` to check every one. Each comes back `current` (nothing newer, left alone), " +
        "`updated` with the old and new revision, or `failed` with why — one failure does not stop the rest. Use " +
        "this when the user asks to update, refresh, or upgrade Plugins. Tell the user any `next` an update returns.",
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
      inputSchema: UpdatePluginsInputSchema,
      outputSchema: UpdatePluginsOutputSchema,
    },
    async ({ name, namespace, agent, force }) => {
      logger.debug(`update_plugins name=${name ?? "(all)"} agent=${agent ?? ""} force=${force ?? false}`);
      const outcomes = await updatePlugins(pluginDeps, { name, namespace, agent, force });
      return { content: [{ type: "text", text: JSON.stringify(outcomes) }], structuredContent: { outcomes } };
    },
  );

  server.registerTool(
    "install_mcp_server",
    {
      title: "Install an MCP Server",
      description:
        "Add an MCP Server from your team's Skillset Registry to this project's .mcp.json. It always installs " +
        "at project scope, even when this server installs Skills at user scope. " +
        "Use this when the user asks to install, add, or configure an MCP Server; pass the exact name " +
        "search_mcp_servers returned. A server already " +
        "configured under the same key is refused; set `force` only when the user asks to replace it. The agent " +
        "usually needs restarting, or the server approving, before its tools appear — tell the user so.",
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
      inputSchema: InstallMcpServerInputSchema,
      outputSchema: InstallMcpServerOutputSchema,
    },
    async ({ name, namespace, force }) => {
      logger.debug(`install_mcp_server name=${name} namespace=${namespace ?? ""} force=${force ?? false}`);
      const result = await installMcp(pluginDeps, { name, namespace, force });
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: { ...result } };
    },
  );

  server.registerResource(
    "skill",
    new ResourceTemplate("skillset://skills/{name}", {
      list: async () => ({ resources: await listSkillResources(fetchImpl, config.registry) }),
      complete: { name: (value) => completeSkillName(fetchImpl, config.registry, value) },
    }),
    {
      title: "Skillset Skill",
      description:
        "One Skill's SKILL.md, straight from the Registry — the same content read_skill returns, reachable " +
        "without a tool call so a host can list, complete, and attach it directly.",
      mimeType: "text/markdown",
    },
    async (uri, variables: Variables) => {
      const skillName = resourceVariable(variables, "name");
      const { body } = await readSkillResource(fetchImpl, config.registry, skillName);
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: body }] };
    },
  );

  server.registerResource(
    "tag",
    new ResourceTemplate("skillset://tags/{tag}", {
      list: async () => ({ resources: await listTagResources(fetchImpl, config.registry) }),
      complete: { tag: (value) => completeTagName(fetchImpl, config.registry, value) },
    }),
    {
      title: "Skillset Tag",
      description: "Every Skill carrying one catalog Tag, as name and description — the same filter search_skills' `tag` argument applies.",
      mimeType: "application/json",
    },
    async (uri, variables: Variables) => {
      const tagName = resourceVariable(variables, "tag");
      const { skills } = await readTagResource(fetchImpl, config.registry, tagName);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(skills) }] };
    },
  );

  return server;
}
