import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addSkills, type AddSkillsContext } from "./add-skills.js";
import type { McpConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { searchSkills } from "./search-skills.js";

const SearchSkillsInputSchema = {
  query: z.string().min(1).describe("What to search for — a task or a problem description, not necessarily a Skill's exact name."),
  tag: z.string().optional().describe("A Tag id to narrow the search to."),
  limit: z.number().int().positive().optional().describe("The most results to return."),
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
 * writes an install against.
 * @returns An `McpServer`, ready to `connect()` to a transport.
 *
 * @remarks
 * This is the one part of the SDK wiring not covered by a unit test at the same rigor as
 * {@link searchSkills} and {@link addSkills} themselves — the acceptance bar here is that each
 * *handler* is a plain, independently-testable function, which their own test files already
 * cover. No tool here writes to the Registry under any flag.
 *
 * @example
 * ```ts
 * const server = createServer(config, fetch, createLogger(config.logLevel), ctx);
 * await server.connect(new StdioServerTransport());
 * ```
 */
export function createServer(config: McpConfig, fetchImpl: typeof fetch, logger: Logger, ctx: AddSkillsContext): McpServer {
  const server = new McpServer({ name: "skillset-mcp", version: "0.0.0" });

  server.registerTool(
    "search_skills",
    {
      title: "Search Skills",
      description: "Search the Skillset Registry's catalog for Skills matching a query, filtered to the skill Kind.",
      inputSchema: SearchSkillsInputSchema,
    },
    async ({ query, tag, limit }) => {
      logger.debug(`search_skills query=${query} tag=${tag ?? ""} limit=${limit ?? ""}`);
      const results = await searchSkills(fetchImpl, config.registry, { query, tag, limit });
      return { content: [{ type: "text", text: JSON.stringify(results) }] };
    },
  );

  server.registerTool(
    "add_skills",
    {
      title: "Add Skills",
      description:
        "Install one or more Skills from the Skillset Registry into the configured Agent's skills directory. " +
        "Returns one outcome per Skill; one failing does not stop the others.",
      inputSchema: AddSkillsInputSchema,
    },
    async ({ names, overwrite }) => {
      logger.debug(`add_skills names=${names.join(",")} overwrite=${overwrite ?? false}`);
      const outcomes = await addSkills(
        { fetchImpl, registry: config.registry, ctx, scope: config.scope, agentId: config.agentId, overwrite: overwrite ?? false },
        names,
      );
      return { content: [{ type: "text", text: JSON.stringify(outcomes) }] };
    },
  );

  return server;
}
