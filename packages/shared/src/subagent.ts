import { z } from "zod";
import { normalizeAllowedTools, parseFrontmatterFields } from "./frontmatter.js";
import { ArtifactFileSchema, SkillSummarySchema } from "./skill.js";
import {
  subagentFileName,
  validateSubagentBody,
  validateSubagentDescription,
  validateSubagentModel,
  validateSubagentName,
  validateSubagentTools,
} from "./subagent-rules.js";

/**
 * A Subagent's `resources.payload` (ADR-0046). Each key is always present; a
 * publish that doesn't set a field stores `null`, the full-replace semantics
 * a Skill's payload has (ADR-0002).
 */
export const SubagentPayloadSchema = z.object({
  kind: z.literal("subagent"),
  tools: z.string().nullable(),
  model: z.string().nullable(),
});
export type SubagentPayload = z.infer<typeof SubagentPayloadSchema>;

/** A single Subagent, with its system prompt as `body`. Sanitise the body before rendering it. */
export const SubagentSchema = SkillSummarySchema.omit({
  kind: true,
  license: true,
  compatibility: true,
  metadata: true,
  allowed_tools: true,
}).extend({
  kind: z.literal("subagent"),
  tools: z.string().nullable(),
  model: z.string().nullable(),
  body: z.string(),
});
export type Subagent = z.infer<typeof SubagentSchema>;

/** `PUT /resources/subagent/{name}` request body. The name comes from the path. */
export const SubagentPublishSchema = z.object({
  description: z.string(),
  body: z.string(),
  tools: z.string().optional(),
  model: z.string().optional(),
  source: z.string().optional(),
  files: z.array(ArtifactFileSchema),
});
export type SubagentPublish = z.infer<typeof SubagentPublishSchema>;

/** A parsed Subagent file: its frontmatter fields and the system prompt below them. */
export interface SubagentDocument {
  name: string;
  description: string;
  tools?: string;
  model?: string;
  body: string;
}

/**
 * Parses a Subagent file's YAML frontmatter and body.
 *
 * @remarks
 * Frontmatter keys other than the four read here are ignored, not refused:
 * the file is stored and installed as published (ADR-0046), so a key only an
 * Agent understands still reaches it.
 *
 * @param source - The raw contents of the file.
 * @param fileName - What to call the file in an error.
 * @returns The parsed document. `tools` written as a YAML list is folded to
 * a comma-separated string.
 * @throws SkillValidationError with rule `frontmatter_missing` or
 * `frontmatter_invalid` if the frontmatter is absent or unparseable, or one
 * of the `validateSubagent*` rules if a field fails validation.
 * @example
 * ```ts
 * parseSubagentDocument("---\nname: reviewer\ndescription: Reviews.\n---\nYou review.\n");
 * // -> { name: "reviewer", description: "Reviews.", body: "You review.\n" }
 * ```
 */
export function parseSubagentDocument(source: string, fileName = "The Subagent file"): SubagentDocument {
  const { fields, body } = parseFrontmatterFields(source, fileName);
  const tools = validateSubagentTools(normalizeAllowedTools(fields.tools));
  const model = validateSubagentModel(fields.model);
  return {
    name: validateSubagentName(fields.name),
    description: validateSubagentDescription(fields.description),
    ...(tools !== undefined ? { tools } : {}),
    ...(model !== undefined ? { model } : {}),
    body: validateSubagentBody(body),
  };
}

/** Everything publishing a Subagent takes: the path segment, the request body, and the one file. */
export interface SubagentBundle {
  name: string;
  request: SubagentPublish;
  file: { path: string; bytes: Uint8Array };
}

/**
 * Turns a Subagent file's bytes into everything needed to publish it.
 *
 * @param bytes - The file's contents.
 * @param options - `source`, when the file came out of a repository
 * (ADR-0041).
 * @returns The Subagent's name, its publish request body, and the file to
 * upload, at the path `<name>.md` whatever it was called on disk.
 * @throws SkillValidationError with one of `parseSubagentDocument`'s rules.
 * @example
 * ```ts
 * const bundle = buildSubagentBundle(await Bun.file("reviewer.md").bytes());
 * ```
 */
export function buildSubagentBundle(bytes: Uint8Array, options: { source?: string } = {}): SubagentBundle {
  const { name, ...document } = parseSubagentDocument(new TextDecoder().decode(bytes));
  const path = subagentFileName(name);
  return {
    name,
    request: {
      ...document,
      ...(options.source ? { source: options.source } : {}),
      files: [{ path, size: bytes.byteLength }],
    },
    file: { path, bytes },
  };
}
