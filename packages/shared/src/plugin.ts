import { z } from "zod";
import { collectFiles, isExcludedPath, validateArtifactFiles, validateArtifactSize, type SkillFile } from "./artifact.js";
import { pluginComponents, PluginComponentsSchema } from "./plugin-components.js";
import { isNonBlankString, isWithinMaxLength, matchesPattern } from "./resource-rules.js";
import { ArtifactFileSchema, ArtifactUploadSchema, PublisherSchema, type ArtifactFile } from "./skill.js";
import { SKILL_NAME_MAX_LENGTH, SKILL_NAME_PATTERN } from "./skill-rules.js";
import { TagSchema } from "./tag.js";
import { timestamp } from "./timestamp.js";

/**
 * Every agent a Plugin can be published for, and the manifest that marks a
 * Plugin as built for it.
 *
 * @remarks
 * The one place an agent is described. A Plugin's supported agents are
 * *detected* from which of these manifests it holds, never converted between
 * (spec: "detect, do not convert"). Supporting another agent — Codex
 * (`.codex-plugin/plugin.json`), Cursor (`.cursor-plugin/plugin.json`) — is
 * one entry here plus its install instructions; publishing, storage, and the
 * wire shape do not change.
 *
 * The first manifest present, in this table's order, is the one `description`,
 * `version`, `license`, and `homepage` are read from.
 *
 * `dotPaths` are the root-level dot-prefixed files and folders the agent
 * reads. Publishing drops dot-prefixed paths by default (`.git`, editor
 * folders), so each agent names the ones its Plugins need kept.
 */
export const PLUGIN_AGENTS = {
  "claude-code": {
    label: "Claude Code",
    manifestPath: ".claude-plugin/plugin.json",
    dotPaths: [".claude-plugin", ".mcp.json", ".lsp.json"],
  },
} as const satisfies Record<string, { label: string; manifestPath: string; dotPaths: readonly string[] }>;

export type PluginAgent = keyof typeof PLUGIN_AGENTS;

/** Every agent manifest path: what marks a folder as a Plugin root, for discovery. */
export const PLUGIN_MANIFEST_PATHS: readonly string[] = Object.values(PLUGIN_AGENTS).map((agent) => agent.manifestPath);

export const PLUGIN_AGENT_IDS = Object.keys(PLUGIN_AGENTS) as [PluginAgent, ...PluginAgent[]];

export const PLUGIN_DESCRIPTION_MAX_LENGTH = 1024;

/** The README a Plugin's page shows, when it has one. */
export const PLUGIN_README_FILE_NAME = "README.md";

export type PluginRule =
  | "name_required"
  | "name_too_long"
  | "name_invalid"
  | "name_mismatch"
  | "description_required"
  | "description_too_long"
  | "manifest_missing"
  | "manifest_invalid"
  | "agents_invalid"
  | "ambiguous_layout";

/** Thrown when a Plugin fails a publishing rule. `field` names the manifest file or request field at fault. */
export class PluginValidationError extends Error {
  readonly rule: PluginRule;
  readonly field: string | undefined;

  constructor(rule: PluginRule, message: string, field?: string) {
    super(message);
    this.name = "PluginValidationError";
    this.rule = rule;
    this.field = field;
  }
}

/**
 * Checks a Plugin's name: kebab-case like a Skill's.
 *
 * @remarks
 * No name is reserved. Claude Code reserves some *marketplace* names, not
 * plugin names — Anthropic's own plugins are named `claude-md-management` and
 * the like.
 *
 * @param value - The candidate name, from the Plugin's manifest or a publish path.
 * @returns The name, unchanged.
 * @throws PluginValidationError `name_required`, `name_too_long`, or `name_invalid`.
 * @example
 * ```ts
 * validatePluginName("code-review-suite"); // -> "code-review-suite"
 * ```
 */
export function validatePluginName(value: unknown): string {
  if (!isNonBlankString(value)) {
    throw new PluginValidationError("name_required", "A Plugin needs a name in its manifest.", "name");
  }
  if (!isWithinMaxLength(value, SKILL_NAME_MAX_LENGTH)) {
    throw new PluginValidationError(
      "name_too_long",
      `A Plugin's name is at most ${SKILL_NAME_MAX_LENGTH} characters.`,
      "name",
    );
  }
  if (!matchesPattern(value, SKILL_NAME_PATTERN)) {
    throw new PluginValidationError(
      "name_invalid",
      "A Plugin's name is lowercase letters, digits, and single hyphens (e.g. code-review-suite).",
      "name",
    );
  }
  return value;
}

/**
 * Checks a Plugin's description: required, at most 1024 characters.
 *
 * @param value - The candidate description, from the Plugin's manifest.
 * @returns The description, unchanged.
 * @throws PluginValidationError `description_required` or `description_too_long`.
 * @example
 * ```ts
 * validatePluginDescription("Reviews pull requests.");
 * ```
 */
export function validatePluginDescription(value: unknown): string {
  if (!isNonBlankString(value)) {
    throw new PluginValidationError(
      "description_required",
      "A Plugin needs a description in its manifest.",
      "description",
    );
  }
  if (!isWithinMaxLength(value, PLUGIN_DESCRIPTION_MAX_LENGTH)) {
    throw new PluginValidationError(
      "description_too_long",
      `A Plugin's description is at most ${PLUGIN_DESCRIPTION_MAX_LENGTH} characters.`,
      "description",
    );
  }
  return value;
}

/**
 * The agents a set of Plugin file paths has a manifest for, in table order.
 *
 * @param paths - Paths relative to the Plugin's root.
 * @returns The supported agents; empty when no agent manifest is present.
 * @example
 * ```ts
 * pluginAgentsForPaths([".claude-plugin/plugin.json", "commands/review.md"]); // -> ["claude-code"]
 * ```
 */
export function pluginAgentsForPaths(paths: readonly string[]): PluginAgent[] {
  const present = new Set(paths);
  return PLUGIN_AGENT_IDS.filter((agent) => present.has(PLUGIN_AGENTS[agent].manifestPath));
}

/**
 * Checks that a Plugin's declared agents are exactly the ones its files hold a manifest for.
 *
 * @remarks
 * The API never reads Artifact bytes (ADR-0001), so it cannot detect the
 * agents itself. It holds the publisher's declaration to the manifest paths it
 * was told about — the same trust a Skill's frontmatter gets.
 *
 * @param agents - The declared agents.
 * @param paths - The Plugin's declared file paths.
 * @returns The agents, unchanged.
 * @throws PluginValidationError `manifest_missing` when no agent manifest is
 * declared, or `agents_invalid` when the declared agents differ from the manifests.
 * @example
 * ```ts
 * validatePluginAgents(["claude-code"], [".claude-plugin/plugin.json"]);
 * ```
 */
export function validatePluginAgents(agents: readonly string[], paths: readonly string[]): PluginAgent[] {
  const detected = pluginAgentsForPaths(paths);
  if (detected.length === 0) {
    throw new PluginValidationError("manifest_missing", missingManifestMessage(), "files");
  }
  const declared = [...new Set(agents)].sort();
  if (declared.join() !== [...detected].sort().join()) {
    throw new PluginValidationError(
      "agents_invalid",
      `A Plugin's agents must match its manifests: its files support ${detected.join(", ")}.`,
      "agents",
    );
  }
  return detected;
}

function missingManifestMessage(): string {
  const paths = PLUGIN_AGENT_IDS.map((agent) => PLUGIN_AGENTS[agent].manifestPath).join(" or ");
  return `A Plugin needs an agent manifest at its root: ${paths}.`;
}

/** The marketplace name Claude Code installs Registry Plugins from: `claude plugin install <entry>@skillset`. */
export const CLAUDE_MARKETPLACE_NAME = "skillset";

/** Where the Registry serves its Claude Code marketplace file, relative to its public URL. */
export const CLAUDE_MARKETPLACE_PATH = "/.claude-plugin/marketplace.json";

/**
 * A Plugin's name in the Claude Code marketplace.
 *
 * @remarks
 * A marketplace holds one entry per name, while the Registry can hold one
 * Plugin per name per Namespace (ADR-0042). A Plugin published here keeps its
 * plain name; one Imported from elsewhere always carries its Namespace, so an
 * entry's name never changes when another party later publishes the same name.
 *
 * @param name - The Plugin's name.
 * @param namespace - Which party named it.
 * @param isOwn - Whether `namespace` is this Registry's own.
 * @returns The entry name, e.g. `review-suite` or `review-suite--acme-plugins`.
 * @example
 * ```ts
 * claudeMarketplaceEntryName("review-suite", "acme/plugins", false); // -> "review-suite--acme-plugins"
 * ```
 */
export function claudeMarketplaceEntryName(name: string, namespace: string, isOwn: boolean): string {
  return isOwn ? name : `${name}--${namespace.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}`;
}

/** A Plugin's `resources.payload` (ADR-0026). The three scalars come from the same manifest as `description`. */
export const PluginPayloadSchema = z.object({
  kind: z.literal("plugin"),
  agents: z.array(z.enum(PLUGIN_AGENT_IDS)).min(1),
  version: z.string().nullable(),
  license: z.string().nullable(),
  homepage: z.string().nullable(),
  /** Absent for a Plugin published before the Registry read components. */
  components: PluginComponentsSchema.nullable().optional(),
});
export type PluginPayload = z.infer<typeof PluginPayloadSchema>;

/** A single Plugin, flat like `SkillSchema`. `body` is its README, when it has one; sanitise it before rendering. */
export const PluginSchema = z.object({
  id: z.string(),
  kind: z.literal("plugin"),
  namespace: z.string(),
  name: z.string(),
  description: z.string().max(PLUGIN_DESCRIPTION_MAX_LENGTH),
  body: z.string().nullable(),
  agents: z.array(z.enum(PLUGIN_AGENT_IDS)),
  version: z.string().nullable(),
  license: z.string().nullable(),
  homepage: z.string().nullable(),
  /** `null` for a Plugin published before the Registry read components; republish to fill it. */
  components: PluginComponentsSchema.nullable(),
  source: z.string(),
  published_at: timestamp,
  updated_at: timestamp,
  published_by: PublisherSchema,
  tags: z.array(TagSchema),
  installs: z.number().int().nonnegative(),
});
export type Plugin = z.infer<typeof PluginSchema>;

/** `PUT /resources/plugin/{name}`'s body. The name comes from the path. */
export const PluginPublishSchema = z.object({
  description: z.string(),
  body: z.string().nullable(),
  agents: z.array(z.enum(PLUGIN_AGENT_IDS)),
  version: z.string().optional(),
  license: z.string().optional(),
  homepage: z.string().optional(),
  source: z.string().optional(),
  components: PluginComponentsSchema,
  files: z.array(ArtifactFileSchema),
});
export type PluginPublish = z.infer<typeof PluginPublishSchema>;

/** `PUT /resources/plugin/{name}`'s response: the Plugin as stored, and where to write its Artifact. */
export const PluginPublishedSchema = z.object({
  plugin: PluginSchema,
  upload: ArtifactUploadSchema,
});
export type PluginPublished = z.infer<typeof PluginPublishedSchema>;

/** Everything publishing a Plugin takes: the path segment, the request body, and the files to upload in `request.files` order. */
export interface PluginBundle {
  name: string;
  request: PluginPublish;
  files: SkillFile[];
}

/** The fields a manifest may set that the Registry reads. Everything else in it is the agent's business. */
const PluginManifestSchema = z.looseObject({
  name: z.unknown(),
  description: z.unknown().optional(),
  version: z.unknown().optional(),
  license: z.unknown().optional(),
  homepage: z.unknown().optional(),
});

function readManifest(file: SkillFile): z.infer<typeof PluginManifestSchema> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(file.bytes));
  } catch {
    throw new PluginValidationError("manifest_invalid", `${file.path} is not valid JSON.`, file.path);
  }
  const result = PluginManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new PluginValidationError("manifest_invalid", `${file.path} must be a JSON object.`, file.path);
  }
  return result.data;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

const KEPT_DOT_PATHS: ReadonlySet<string> = new Set(
  Object.values(PLUGIN_AGENTS).flatMap((agent) => agent.dotPaths),
);

/**
 * Like `isExcludedPath`, but keeps the root dot paths an agent reads. A
 * leading wrapping folder is allowed for, since files are collected before it
 * is stripped.
 */
function isExcludedPluginPath(path: string): boolean {
  const segments = path.split("/");
  for (const skip of [0, 1]) {
    const top = segments[skip];
    if (top !== undefined && KEPT_DOT_PATHS.has(top) && segments.slice(0, skip).every((s) => !s.startsWith("."))) {
      const rest = segments.slice(skip + 1).join("/");
      return rest !== "" && isExcludedPath(rest);
    }
  }
  return isExcludedPath(path);
}

/**
 * A single wrapping directory — what you get from dropping the folder rather
 * than its contents — is stripped, as it is for a Skill.
 */
function stripPluginWrapper(files: SkillFile[]): SkillFile[] {
  if (pluginAgentsForPaths(files.map((file) => file.path)).length > 0) return files;
  const tops = new Set(files.map((file) => file.path.split("/")[0] ?? ""));
  const [wrapper] = [...tops];
  if (tops.size === 1 && wrapper !== undefined) {
    const stripped = files
      .filter((file) => file.path.startsWith(`${wrapper}/`))
      .map((file) => ({ ...file, path: file.path.slice(wrapper.length + 1) }));
    if (pluginAgentsForPaths(stripped.map((file) => file.path)).length > 0) return stripped;
  }
  throw new PluginValidationError("manifest_missing", missingManifestMessage(), "files");
}

/**
 * Turns a Plugin's folder into everything needed to publish it.
 *
 * @remarks
 * The agents are detected from which manifests are present. Every manifest
 * must give the same `name`; `description`, `version`, `license`, and
 * `homepage` come from the first manifest in `PLUGIN_AGENTS` order. A root
 * `README.md` becomes the page's body.
 *
 * @param files - The Plugin's files, at paths relative to its root or to one
 * wrapping folder. Excluded paths (`.git`, `node_modules`, …) are dropped.
 * @param options - `source`, when the files came from a repository.
 * @returns The Plugin's name, its publish request body, and the files to upload.
 * @throws PluginValidationError `manifest_missing`, `manifest_invalid`,
 * `name_mismatch`, or a name or description rule; SkillValidationError when
 * the files exceed what an Artifact may hold.
 * @example
 * ```ts
 * const bundle = buildPluginBundle(files);
 * await fetch(`/api/resources/plugin/${bundle.name}`, { method: "PUT", body: JSON.stringify(bundle.request) });
 * ```
 */
export function buildPluginBundle(files: SkillFile[], options: { source?: string } = {}): PluginBundle {
  const collected = stripPluginWrapper(collectFiles(files, isExcludedPluginPath));
  validateArtifactSize(collected, (file) => file.bytes.byteLength);

  const byPath = new Map(collected.map((file) => [file.path, file]));
  const agents = pluginAgentsForPaths([...byPath.keys()]);
  const manifests = agents.map((agent) => {
    const path = PLUGIN_AGENTS[agent].manifestPath;
    const file = byPath.get(path);
    if (!file) throw new PluginValidationError("manifest_missing", missingManifestMessage(), path);
    return { path, manifest: readManifest(file) };
  });

  const [primary] = manifests;
  if (!primary) throw new PluginValidationError("manifest_missing", missingManifestMessage(), "files");
  const name = validatePluginName(primary.manifest.name);
  for (const { path, manifest } of manifests) {
    if (manifest.name !== name) {
      throw new PluginValidationError(
        "name_mismatch",
        `Every manifest must give the same name: ${primary.path} says "${name}", ${path} says "${String(manifest.name)}".`,
        path,
      );
    }
  }

  const readme = byPath.get(PLUGIN_README_FILE_NAME);
  const manifest: ArtifactFile[] = collected.map((file) => ({ path: file.path, size: file.bytes.byteLength }));
  const version = optionalString(primary.manifest.version);
  const license = optionalString(primary.manifest.license);
  const homepage = optionalString(primary.manifest.homepage);
  return {
    name,
    request: {
      description: validatePluginDescription(primary.manifest.description),
      body: readme ? new TextDecoder().decode(readme.bytes) : null,
      agents,
      ...(version ? { version } : {}),
      ...(license ? { license } : {}),
      ...(homepage ? { homepage } : {}),
      ...(options.source ? { source: options.source } : {}),
      components: pluginComponents(collected, primary.path, primary.manifest),
      files: manifest,
    },
    files: collected,
  };
}

/**
 * Validates a declared Plugin manifest: the generic Artifact rules, plus at least one agent manifest.
 *
 * @param value - The candidate file list, straight off the wire.
 * @returns The manifest, typed and with its paths normalised.
 * @throws PluginValidationError `manifest_missing`; SkillValidationError for any generic Artifact rule.
 * @example
 * ```ts
 * validatePluginFiles([{ path: ".claude-plugin/plugin.json", size: 120 }]);
 * ```
 */
export function validatePluginFiles(value: unknown): ArtifactFile[] {
  const files = validateArtifactFiles(value);
  if (pluginAgentsForPaths(files.map((file) => file.path)).length === 0) {
    throw new PluginValidationError("manifest_missing", missingManifestMessage(), "files");
  }
  return files;
}
