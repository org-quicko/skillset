import {
  isKind,
  KIND_KEYS,
  validateArtifactManifest,
  validateResourceSource,
  validateSkillAllowedTools,
  validateSkillBody,
  validateSkillCompatibility,
  validateSkillDescription,
  validateSkillLicense,
  validateSkillMetadata,
  validateSkillName,
  validateTagNames,
} from "@in-org-quicko/skillset-shared";
import { z } from "zod";
import { ruleSchema } from "../../lib/validator.js";

/**
 * `PUT /resources/{kind}/{name}`'s path.
 *
 * @remarks
 * An unregistered Kind is refused naming the field, not answered as a 404: the
 * Kind chooses what gets written (ADR-0026).
 */
export const PublishParamsSchema = z.object({
  kind: z.string().refine(isKind, {
    error: (issue) => `Unknown Kind "${String(issue.input)}". Known: ${KIND_KEYS.join(", ")}.`,
  }),
  name: ruleSchema(validateSkillName),
});

/**
 * `PUT /resources/{kind}/{name}`'s body, held to the shared Skill rules.
 *
 * @remarks
 * A failing optional field rejects the publish exactly like a failing required
 * one (ADR-0009).
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

/** `PUT /resources/{id}/tags`'s body: the full replacement set of Tag names. */
export const SetTagsBodySchema = z.object({ tags: ruleSchema(validateTagNames) });
