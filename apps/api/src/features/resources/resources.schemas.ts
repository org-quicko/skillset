import {
  type ArtifactFile,
  isKind,
  KIND_KEYS,
  kindConfig,
  type ResourcePayload,
  validateArtifactManifest,
  validateResourceSource,
  validateSkillAllowedTools,
  validateSkillBody,
  validateSkillCompatibility,
  validateSkillDescription,
  validateSkillLicense,
  validateSkillMetadata,
  validateSubagentBody,
  validateSubagentDescription,
  validateSubagentManifest,
  validateSubagentModel,
  validateSubagentTools,
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
 * own rule.
 */
export const PublishParamsSchema = z
  .object({
    kind: z.string().refine(isKind, {
      error: (issue) => `Unknown Kind "${String(issue.input)}". Known: ${KIND_KEYS.join(", ")}.`,
    }),
    name: z.unknown(),
  })
  .transform(({ kind, name }, ctx) => {
    const parsed = ruleSchema(kindConfig(kind).validateName).safeParse(name);
    if (parsed.success) return { kind, name: parsed.data };
    for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: ["name"] });
    return z.NEVER;
  });

/** What a publish writes, once its body has been held to its Kind's rules. */
export interface PublishInput {
  description: string;
  body: string;
  source?: string;
  files: ArtifactFile[];
  payload: ResourcePayload;
}

const source = ruleSchema(validateResourceSource).optional();

/**
 * A Skill's publish body, held to the shared Skill rules.
 *
 * @remarks
 * A failing optional field rejects the publish exactly like a failing required
 * one (ADR-0009). A field the body does not set is stored as `null`, so a
 * republish clears what an earlier one stored (ADR-0002).
 */
const SkillPublishBodySchema = z
  .object({
    description: ruleSchema(validateSkillDescription),
    body: ruleSchema(validateSkillBody),
    license: ruleSchema(validateSkillLicense).optional(),
    compatibility: ruleSchema(validateSkillCompatibility).optional(),
    metadata: ruleSchema(validateSkillMetadata).optional(),
    allowed_tools: ruleSchema(validateSkillAllowedTools).optional(),
    source,
    files: ruleSchema(validateArtifactManifest),
  })
  .transform(
    ({ license, compatibility, metadata, allowed_tools, ...common }): PublishInput => ({
      ...common,
      payload: {
        kind: "skill",
        license: license ?? null,
        compatibility: compatibility ?? null,
        metadata: metadata ?? null,
        allowed_tools: allowed_tools ?? null,
      },
    }),
  );

/** A Subagent's publish body (ADR-0046). Its Manifest is exactly the one file `<name>.md`. */
const subagentPublishBodySchema = (name: string) =>
  z
    .object({
      description: ruleSchema(validateSubagentDescription),
      body: ruleSchema(validateSubagentBody),
      tools: ruleSchema(validateSubagentTools).optional(),
      model: ruleSchema(validateSubagentModel).optional(),
      source,
      files: ruleSchema((value) => validateSubagentManifest(name, value)),
    })
    .transform(
      ({ tools, model, ...common }): PublishInput => ({
        ...common,
        payload: { kind: "subagent", tools: tools ?? null, model: model ?? null },
      }),
    );

/**
 * The schema `PUT /resources/{kind}/{name}`'s body must satisfy.
 *
 * @param kind - A registered Kind.
 * @param name - The Resource's name, for the Kinds whose Manifest depends on it.
 * @returns The schema, whose output is the {@link PublishInput} to write.
 * @throws Error if `kind` has no publish body registered here, which means a
 * Kind was added to `KINDS` without one.
 * @example
 * ```ts
 * const input = parseValue(await c.req.json(), publishBodySchema(kind, name));
 * ```
 */
export function publishBodySchema(kind: string, name: string): z.ZodType<PublishInput> {
  if (kind === "skill") return SkillPublishBodySchema;
  if (kind === "subagent") return subagentPublishBodySchema(name);
  throw new Error(`No publish body is defined for Kind "${kind}".`);
}

/** `PUT /resources/{id}/tags`'s body: the full replacement set of Tag names. */
export const SetTagsBodySchema = z.object({ tags: ruleSchema(validateTagNames) });
