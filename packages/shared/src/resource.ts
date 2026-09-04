import { z } from "zod";
import { SKILL_DESCRIPTION_MAX_LENGTH, validateSkillName } from "./skill-rules.js";
import { PublisherSchema, SkillPayloadSchema } from "./skill.js";
import { TagSchema } from "./tag.js";
import { timestamp } from "./timestamp.js";

/**
 * A Kind's own rules and shape (ADR-0026): its name validator, its
 * `description` ceiling, whether it has an Artifact to publish and download
 * (ADR-0027), and the Zod schema its payload must satisfy.
 */
export interface KindConfig {
  validateName: (value: unknown) => string;
  descriptionMaxLength: number;
  hasArtifact: boolean;
  payloadSchema: z.ZodTypeAny;
}

/**
 * The Kinds this Registry holds Resources of, keyed by name.
 *
 * @remarks
 * Plain text, not a Postgres enum or a `z.enum` — the treatment
 * `integrations.provider` already gets against `GIT_PROVIDERS` (ADR-0024).
 * Registering a new Kind is an insert here, not a migration. `skill` is the
 * only one registered in this ticket; `mcp-server` and `plugin` follow later
 * (spec: `.scratch/generic-resources/spec.md`).
 */
export const KINDS: Record<string, KindConfig> = {
  skill: {
    validateName: validateSkillName,
    descriptionMaxLength: SKILL_DESCRIPTION_MAX_LENGTH,
    hasArtifact: true,
    payloadSchema: SkillPayloadSchema,
  },
};

/** The Kind keys, for a picker or an error message. */
export const KIND_KEYS = Object.keys(KINDS);

/**
 * Whether a string names a Kind this Registry knows.
 *
 * @param kind - The candidate name.
 * @returns Whether a config exists for it.
 * @example
 * ```ts
 * if (!isKind(input.kind)) throw new ValidationError("Unknown Kind.");
 * ```
 */
export function isKind(kind: string): boolean {
  return Object.hasOwn(KINDS, kind);
}

/**
 * The config for a Kind.
 *
 * @param kind - The Kind's name.
 * @returns Its config.
 * @throws Error if no such Kind is known. Callers reaching this have skipped
 * `isKind` on a value from outside, which is a bug rather than a refusal to
 * render.
 * @example
 * ```ts
 * const { hasArtifact } = kindConfig("skill");
 * ```
 */
export function kindConfig(kind: string): KindConfig {
  const config = KINDS[kind];
  if (!config) {
    throw new Error(`Unknown Kind "${kind}". Known: ${KIND_KEYS.join(", ")}.`);
  }
  return config;
}

/**
 * The shape a Resource's `payload` column must satisfy, narrowed by `kind`
 * (ADR-0026). `skill` is the only variant in this ticket; a fourth Kind adds
 * one here alongside a `KINDS` entry.
 */
export const ResourcePayloadSchema = z.discriminatedUnion("kind", [SkillPayloadSchema]);
export type ResourcePayload = z.infer<typeof ResourcePayloadSchema>;

/**
 * The fields every Kind has in common (ADR-0026) — everything else about a
 * Resource lives in its Kind-specific `payload`. No route returns this shape
 * directly yet: `/resources/*` still returns `SkillSchema`, which predates
 * this split and keeps its own flat shape rather than nesting a `payload` —
 * that stays true until a second Kind exists to nest. This is the foundation
 * ticket 3's per-Kind response shape builds on.
 */
export const ResourceSchema = z.object({
  id: z.string(),
  kind: z.string(),
  name: z.string(),
  description: z.string(),
  // Nullable, unlike SkillSchema's `body`: not every future Kind supplies one
  // (ADR-0026), though Skill's own shared validation still requires it.
  body: z.string().nullable(),
  published_by: PublisherSchema,
  published_at: timestamp,
  installs: z.number().int().nonnegative(),
  tags: z.array(TagSchema),
});
export type Resource = z.infer<typeof ResourceSchema>;
