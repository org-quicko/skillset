import {
  isKind,
  KIND_KEYS,
  kindConfig,
  McpPackageSchema,
  McpRemoteSchema,
  McpValidationError,
  PLUGIN_AGENT_IDS,
  PluginComponentsSchema,
  PluginValidationError,
  SkillValidationError,
  validateArtifactManifest,
  validateMcpDescription,
  validatePluginAgents,
  validatePluginDescription,
  validatePluginFiles,
  validateResourceSource,
  validateSkillAllowedTools,
  validateSkillBody,
  validateSkillCompatibility,
  validateSkillDescription,
  validateSkillLicense,
  validateSkillMetadata,
  validateTagNames,
} from "@in-org-quicko/skillset-shared";
import { z } from "zod";
import { ruleSchema } from "../../lib/validator.js";

/**
 * `PUT /resources/{kind}/{name}`'s path.
 *
 * @remarks
 * An unregistered Kind is refused naming the field, not answered as a 404: the
 * Kind chooses what gets written (ADR-0026). The name is held to that Kind's
 * own validation rule.
 */
export const PublishParamsSchema = z
  .object({
    kind: z.string().refine(isKind, {
      error: (issue) => `Unknown Kind "${String(issue.input)}". Known: ${KIND_KEYS.join(", ")}.`,
    }),
    name: z.string(),
  })
  .superRefine((data, ctx) => {
    try {
      kindConfig(data.kind).validateName(data.name);
    } catch (error) {
      if (
        error instanceof SkillValidationError ||
        error instanceof McpValidationError ||
        error instanceof PluginValidationError
      ) {
        ctx.addIssue({
          code: "custom",
          message: error.message,
          params: { rule: error.rule, field: error.field ?? "name" },
        });
      } else {
        ctx.addIssue({
          code: "custom",
          message: error instanceof Error ? error.message : String(error),
          path: ["name"],
        });
      }
    }
  });

/**
 * `PUT /resources/skill/{name}`'s body, held to the shared Skill rules.
 */
export const PublishBodySchema = z.object({
  description: ruleSchema(validateSkillDescription),
  body: ruleSchema(validateSkillBody),
  license: ruleSchema(validateSkillLicense).optional(),
  compatibility: ruleSchema(validateSkillCompatibility).optional(),
  metadata: ruleSchema(validateSkillMetadata).optional(),
  allowed_tools: ruleSchema(validateSkillAllowedTools).optional(),
  source: ruleSchema(validateResourceSource).optional(),
  files: ruleSchema(validateArtifactManifest),
});
export type PublishBody = z.infer<typeof PublishBodySchema>;

/**
 * `PUT /resources/mcp/{name}`'s body, held to the shared MCP rules.
 */
export const PublishMcpBodySchema = z
  .object({
    description: ruleSchema(validateMcpDescription),
    body: z.string().nullable().optional(),
    packages: z.array(McpPackageSchema).optional(),
    remotes: z.array(McpRemoteSchema).optional(),
    source: ruleSchema(validateResourceSource).optional(),
  })
  .refine(
    (data) => (data.packages && data.packages.length > 0) || (data.remotes && data.remotes.length > 0),
    { message: "An MCP server must have at least one package or remote.", path: ["packages"] },
  );
export type PublishMcpBody = z.infer<typeof PublishMcpBodySchema>;

/** `PUT /resources/{id}/tags`'s body: the full replacement set of Tag names. */
export const SetTagsBodySchema = z.object({ tags: ruleSchema(validateTagNames) });

/**
 * `PUT /resources/plugin/{name}`'s body, held to the shared Plugin rules.
 *
 * @remarks
 * `agents` must be exactly the agents the declared files hold a manifest for
 * (`validatePluginAgents`) — the API never reads the bytes (ADR-0001).
 */
export const PublishPluginBodySchema = z
  .object({
    description: ruleSchema(validatePluginDescription),
    body: z.string().nullable(),
    agents: z.array(z.enum(PLUGIN_AGENT_IDS)),
    version: z.string().optional(),
    license: z.string().optional(),
    homepage: z.string().optional(),
    source: ruleSchema(validateResourceSource).optional(),
    components: PluginComponentsSchema,
    files: ruleSchema(validatePluginFiles),
  })
  .superRefine((data, ctx) => {
    try {
      validatePluginAgents(data.agents, data.files.map((file) => file.path));
    } catch (error) {
      if (!(error instanceof PluginValidationError)) throw error;
      ctx.addIssue({ code: "custom", message: error.message, params: { rule: error.rule, field: error.field } });
    }
  });
export type PublishPluginBody = z.infer<typeof PublishPluginBodySchema>;
