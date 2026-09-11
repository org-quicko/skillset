import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AgentDetection } from "@in-org-quicko/skillset-shared";
import type { McpConfig } from "./config.js";
import { resolveAgent } from "./detect-agent.js";
import type { Logger } from "./logger.js";
import { addSkills, type AddSkillsContext } from "./tools/add-skills.js";
import { publishSkill } from "./tools/publish-skill.js";
import { searchSkills } from "./tools/search-skills.js";

// Surfaced to the client in `InitializeResult.instructions`, which hosts inject into the
// system prompt. This is the only channel that sits at the same level as a host's own
// built-in Skill catalog (Claude Desktop, Claude Code); a tool `description` is only read
// once the model has already decided to look at the tool list, which is too late to stop it
// resolving the word "Skill" against the catalog it was born knowing about. Hence the
// framing here: not "search Skills" but "this catalog is remote, and you cannot see it".
const SERVER_INSTRUCTIONS =
  "Skillset is this team's remote Skill Registry. It is a network service, and its contents are " +
  "NOT part of your built-in Skill catalog, your bundled/plugin Skills, or anything on this " +
  "filesystem — you cannot see, list, or name a single Skill in it without calling search_skills.\n\n" +
  "Whenever the user asks about Skills — whether one exists, to find/search/browse/list Skills, to " +
  "add or install one, or describes a capability a Skill might cover — call search_skills FIRST, on " +
  "every such request. Do this even when your own Skill catalog appears to already answer it: the two " +
  "catalogs are different sets, and the team's Registry is the authoritative one here. Consulting your " +
  "built-in catalog instead of calling search_skills is always a mistake, and answering \"no such Skill " +
  "exists\" without having called search_skills is always wrong.\n\n" +
  "Then use add_skills with the exact names search_skills returned to install them, and publish_skill " +
  "to share a Skill authored in this project back to the Registry.";

const SearchSkillsInputSchema = {
  query: z
    .string()
    .min(1)
    .describe(
      "A task description or an exact Skill name to find in the shared Skillset catalog. Examples: `adapter`, `write-adapters`, `review pull requests`, or `write changelogs`.",
    ),
  tag: z.string().optional().describe("Optional Tag id to narrow the Skillset search."),
  limit: z.number().int().positive().optional().describe("Optional maximum number of matching Skills to return."),
};

const PublishSkillInputSchema = {
  path: z
    .string()
    .optional()
    .describe(
      "Directory holding the Skill's own SKILL.md, relative to the project root. Defaults to the project root " +
        "itself. Must be the Skill's own directory, not a folder containing several Skills.",
    ),
};

const AddSkillsInputSchema = {
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

/**
 * Builds this server's `McpServer` instance and registers its tools.
 *
 * @param config - The resolved `--registry`/`--scope`/`--agent`/`--log-level`/`--token` configuration.
 * @param fetchImpl - The `fetch` implementation every tool sends its requests with.
 * @param logger - Where to write diagnostics; never stdout (see {@link Logger}).
 * @param ctx - The project root, environment, and home directory `add_skills` and
 * `publish_skill` resolve paths against, and that Agent detection reads its signals from.
 * @returns An `McpServer`, ready to `connect()` to a transport.
 *
 * @remarks
 * This is the one part of the SDK wiring not covered by a unit test at the same rigor as
 * {@link searchSkills}, {@link addSkills}, and `publishSkill` themselves — the acceptance bar
 * here is that each *handler* is a plain, independently-testable function, which their own
 * test files already cover. `publish_skill` is the one tool that writes to the Registry, and
 * the one this server needs a Token for at all (ADR-0035) — every other tool still sends no
 * `authorization` header (ADR-0013). The Agent is detected lazily on the first `add_skills`
 * call — the client's identity is not known until after `initialize` — and cached for the
 * rest of the connection.
 *
 * The server also advertises {@link SERVER_INSTRUCTIONS}, which is what keeps a host from
 * answering a Skill question out of its own built-in catalog instead of calling
 * `search_skills` — see that constant for why a tool `description` cannot do that job alone.
 *
 * @example
 * ```ts
 * const server = createServer(config, fetch, createLogger(config.logLevel), ctx);
 * await server.connect(new StdioServerTransport());
 * ```
 */
export function createServer(config: McpConfig, fetchImpl: typeof fetch, logger: Logger, ctx: AddSkillsContext): McpServer {
  const server = new McpServer(
    { name: "skillset-mcp", version: "0.0.0", title: "Skillset Skill Catalog" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  // Resolved once, lazily: the client's identity is only known after the `initialize`
  // handshake, and `add_skills` — the one tool that needs an Agent — never runs before then.
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
        "`write-adapters`, `review pull requests`, or `write changelogs`. Call this before calling add_skills so " +
        "you have the exact Registry name. Read-only; installs and modifies nothing. Returns matching Skill names " +
        "and descriptions, with optional tag and result-limit filters.",
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: SearchSkillsInputSchema,
    },
    async ({ query, tag, limit }) => {
      logger.debug(`search_skills query=${query} tag=${tag ?? ""} limit=${limit ?? ""}`);
      const results = await searchSkills(fetchImpl, config.registry, { query, tag, limit });
      return {
        content: [{ type: "text", text: JSON.stringify(results) }],
        structuredContent: { results },
      };
    },
  );

  server.registerTool(
    "add_skills",
    {
      title: "Add Skills",
      description:
        "Install one or more Agent Skills from your team's remote Skill Registry into this project, writing each " +
        "into the directory your Agent loads Skills from (detected automatically — you don't supply a path or an " +
        "agent name). Use this when the user asks to add, install, or set up a Skill; pass the exact Skill names " +
        "returned by search_skills. Installs several at once, and one bad name doesn't stop the rest. Returns the " +
        "detected Agent, where each Skill was written, and each Skill's SKILL.md so it's usable immediately. Set " +
        "overwrite only when the user has explicitly asked to update or replace a Skill that's already installed.",
      inputSchema: AddSkillsInputSchema,
    },
    async ({ names, overwrite }) => {
      logger.debug(`add_skills names=${names.join(",")} overwrite=${overwrite ?? false}`);
      const result = await addSkills(
        { fetchImpl, registry: config.registry, ctx, scope: config.scope, detection: resolveDetection(), overwrite: overwrite ?? false },
        names,
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "publish_skill",
    {
      title: "Publish a Skill",
      description:
        "Publish a Skill from this project to your team's shared Skillset Registry, so add_skills can install " +
        "it for everyone else. Use this when the user asks to publish, share, or push a Skill they authored to " +
        "the Registry. Pass `path` to the directory holding that Skill's own SKILL.md (defaults to the project " +
        "root). Republishing an existing name overwrites it completely — there is no versioning. Requires a " +
        "writer Token to be configured on this server (--token or SKILLSET_TOKEN); if none is configured, this " +
        "tool fails naming that as the reason rather than attempting the request.",
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      inputSchema: PublishSkillInputSchema,
    },
    async ({ path }) => {
      logger.debug(`publish_skill path=${path ?? "(project root)"}`);
      if (!config.token) {
        throw new Error(
          "publish_skill needs a writer Token — configure one with --token <token> or the SKILLSET_TOKEN " +
            "environment variable, then restart this server.",
        );
      }
      const result = await publishSkill({ fetchImpl, registry: config.registry, token: config.token, cwd: ctx.cwd }, path);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  return server;
}
