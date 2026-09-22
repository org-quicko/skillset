/**
 * Which party named a Resource (ADR-0042). One module because both derivations
 * and the validator have to agree exactly: a Namespace is compared whole and
 * never parsed, so a value the CLI derives and the same value the API derives
 * must be character-for-character identical or they are two different
 * Namespaces holding two copies of the same Skill.
 */
import type { SkillSourceLocation } from "./skill-source-location.js";

/**
 * Generous for `owner/repo` at either Git Provider, and far short of anything
 * that could bloat a row.
 */
export const NAMESPACE_MAX_LENGTH = 128;

/**
 * Lowercase alphanumerics, dots and hyphens, in one or two `/`-separated
 * segments — a host (`skills.quicko.com`) or an `owner/repo`.
 *
 * @remarks
 * At most one slash, because two would make a Namespace look parseable and it
 * is not: it is compared whole, and nothing ever splits it.
 */
export const NAMESPACE_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?)?$/;

/**
 * Whether a string is a well-formed Namespace.
 *
 * @param value - The candidate.
 * @returns Whether it matches {@link NAMESPACE_PATTERN} and is within
 * {@link NAMESPACE_MAX_LENGTH}.
 * @example
 * ```ts
 * isNamespace("anthropics/skills"); // true
 * isNamespace("Anthropics/Skills"); // false — never uppercase
 * ```
 */
export function isNamespace(value: string): boolean {
  return value.length <= NAMESPACE_MAX_LENGTH && NAMESPACE_PATTERN.test(value);
}

/**
 * This Registry's own Namespace — what anything published straight here is
 * named by.
 *
 * @param publicUrl - The Registry's `PUBLIC_URL`.
 * @returns The URL's host, lowercased — `skills.quicko.com`.
 * @throws Error if no hostname can be read out of `publicUrl`, or if the host
 * is not a well-formed Namespace.
 *
 * @remarks
 * Forward, not the reverse-DNS a Source resolves to (`com.quicko.skills`).
 * The two sit in different fields for different reasons: a Source is only ever
 * linked, where a Namespace is read aloud and typed at a prompt, so it takes
 * the form people already know how to type.
 *
 * @example
 * ```ts
 * registryNamespace("https://skills.quicko.com"); // -> "skills.quicko.com"
 * ```
 */
export function registryNamespace(publicUrl: string): string {
  const trimmed = publicUrl.trim();
  const host = (URL.canParse(trimmed) ? new URL(trimmed).hostname : trimmed).toLowerCase();
  if (!host) throw new Error(`Cannot read a hostname out of "${publicUrl}".`);
  if (!isNamespace(host)) throw new Error(`"${host}" is not a usable Namespace.`);
  return host;
}

/**
 * The Namespace an Imported Resource is named by: the repository it was copied
 * out of.
 *
 * @param location - Where the files were read from.
 * @returns The project's last two path segments, lowercased —
 * `anthropics/skills`.
 * @throws Error if the resulting value is not a well-formed Namespace, which
 * means the provider handed back a project path this rule cannot express.
 *
 * @remarks
 * The **last two** segments rather than the whole project path, because
 * GitLab's nested groups do not fit in the one slash a Namespace allows:
 * `group/subgroup/project` becomes `subgroup/project`. Imprecise, and
 * accepted — a Namespace confers nothing and is never resolved back to an
 * address, so two GitLab projects would have to share both a subgroup name and
 * a project name to collide, and they would then also share every Skill name
 * beneath them.
 *
 * `0006_resource_namespace.sql` derives the same value in SQL for rows that
 * predate the column. The two must not drift.
 *
 * @example
 * ```ts
 * importNamespace({ provider: "github", project: "anthropics/skills", ref: "main", path: "pdf" });
 * // -> "anthropics/skills"
 * ```
 */
export function importNamespace(location: SkillSourceLocation): string {
  const namespace = location.project.toLowerCase().split("/").slice(-2).join("/");
  if (!isNamespace(namespace)) {
    throw new Error(`Cannot derive a Namespace from the project "${location.project}".`);
  }
  return namespace;
}
