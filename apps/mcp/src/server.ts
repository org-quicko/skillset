import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AgentDetection } from "@skillset/shared";
import type { McpConfig } from "./config.js";
import { resolveAgent } from "./detect-agent.js";
import type { Logger } from "./logger.js";
import { addSkills, type AddSkillsContext } from "./tools/add-skills.js";
import { searchSkills } from "./tools/search-skills.js";

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
 * @param config - The resolved `--registry`/`--scope`/`--agent`/`--log-level` configuration.
 * @param fetchImpl - The `fetch` implementation both tools send their requests with.
 * @param logger - Where to write diagnostics; never stdout (see {@link Logger}).
 * @param ctx - The project root, environment, and home directory `add_skills` resolves and
 * writes an install against, and that Agent detection reads its signals from.
 * @returns An `McpServer`, ready to `connect()` to a transport.
 *
 * @remarks
 * This is the one part of the SDK wiring not covered by a unit test at the same rigor as
 * {@link searchSkills} and {@link addSkills} themselves — the acceptance bar here is that each
 * *handler* is a plain, independently-testable function, which their own test files already
 * cover. No tool here writes to the Registry under any flag. The Agent is detected lazily on
 * the first `add_skills` call — the client's identity is not known until after `initialize` —
 * and cached for the rest of the connection.
 *
 * @example
 * ```ts
 * const server = createServer(config, fetch, createLogger(config.logLevel), ctx);
 * await server.connect(new StdioServerTransport());
 * ```
 */
export function createServer(config: McpConfig, fetchImpl: typeof fetch, logger: Logger, ctx: AddSkillsContext): McpServer {
  const server = new McpServer({ name: "skillset-mcp", version: "0.0.0", title: "Skillset Skill Catalog" });

  server.registerPrompt(
    "skillset",
    {
      title: "Use Skillset",
      description: "Search Skillset for relevant Skills and add them to the current project.",
    },
    async () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Explicitly use the Skillset MCP for this task: call search_skills to find relevant Skills, then call " +
              "add_skills with the exact names of the relevant results to add them to this project.",
          },
        },
      ],
    }),
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
        "Search the shared Skillset catalog for Agent Skills. ALWAYS use this tool when the user asks whether a " +
        "Skill exists, asks to find/search/locate a Skill, mentions Skillset, or describes a capability that may " +
        "have a Skill. Search by the user's task or exact Skill name, such as `adapter`, `write-adapters`, " +
        "`review pull requests`, or `write changelogs`. Call this before searching local files or claiming that " +
        "a Skill is unavailable, and before calling add_skills so you have the exact registry name. This is a " +
        "read-only catalog search; it does not install or modify anything. Returns matching Skill names and " +
        "descriptions, with optional tag and result-limit filters.",
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
        "Install one or more Agent Skills from your team's shared Skill catalog into this project, writing each " +
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

  return server;
}
