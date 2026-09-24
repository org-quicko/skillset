import { gitProviderConfig, providerForHost } from "./git-provider.js";
import type { SkillSourceLocation } from "./skill-source-location.js";

/**
 * The longest a Resource's stored `source` may be.
 *
 * Generous for a repository URL and far short of anything that could bloat a
 * row — a project path is capped by the provider long before this.
 */
export const RESOURCE_SOURCE_MAX_LENGTH = 512;

/**
 * Turns a URL or hostname into reverse-DNS notation.
 *
 * @param urlOrHost - An absolute URL, or a bare hostname.
 * @returns The host's labels in reverse order, joined by `.` — lowercased,
 * with any port, path, and userinfo dropped.
 * @throws Error if no hostname can be read out of `urlOrHost`.
 *
 * @remarks
 * This is how a Resource published straight to the Registry names its origin:
 * the Registry itself. Reverse-DNS rather than the URL because it reads as an
 * identity rather than a link — nothing is meant to navigate to it, and it
 * sits beside a repository URL in the same field without inviting a click.
 * It also matches the notation an MCP Server's `name` already uses.
 *
 * A single-label host (`localhost`) reverses to itself, which is correct
 * rather than a special case.
 *
 * @example
 * ```ts
 * reverseDomain("https://skills.quicko.com"); // -> "com.quicko.skills"
 * reverseDomain("http://localhost:3000");     // -> "localhost"
 * ```
 */
export function reverseDomain(urlOrHost: string): string {
  const trimmed = urlOrHost.trim();
  // Parsed as a URL when it looks like one, so a port or a path cannot reach
  // the split below; a bare hostname is taken as-is rather than being forced
  // through a synthetic scheme, which would hide a malformed value.
  const host = URL.canParse(trimmed) ? new URL(trimmed).hostname : trimmed;
  if (!host) throw new Error(`Cannot read a hostname out of "${urlOrHost}".`);

  return host.toLowerCase().split(".").reverse().join(".");
}

/**
 * The repository URL a Skill was imported from.
 *
 * @param location - Where the Skill's files were read from.
 * @returns The project's URL at its Git Provider, with no ref or folder.
 * @throws Error if `location.provider` is not a Git Provider this Registry knows.
 *
 * @remarks
 * The **repository**, not the folder within it: a monorepo's twenty Skills all
 * record the same source, which is the honest answer to "where did this come
 * from" and the one that stays right when the folder is later moved. The ref
 * is left out for the same reason — it named a branch at import time and means
 * nothing afterwards, because an Import is never re-read (ADR-0041).
 *
 * @example
 * ```ts
 * resourceSourceUrl({ provider: "github", project: "org-quicko/skillset", ref: "main", path: "skills/review" });
 * // -> "https://github.com/org-quicko/skillset"
 * ```
 */
export function resourceSourceUrl(location: SkillSourceLocation): string {
  return `https://${gitProviderConfig(location.provider).host}/${location.project}`;
}

/** A Source that names somewhere other than the Registry serving it. */
export interface ImportedSource {
  url: string;
  /** The Git Provider the URL's host belongs to, or null for a host none claims. */
  provider: string | null;
}

/**
 * Reads a Resource's Source as an origin outside this Registry, when it is one.
 *
 * @param source - The Source as a read resolved it: an absolute `http(s)` URL
 * for an Imported Resource, and the Registry's own reverse-DNS domain for one
 * published straight to it.
 * @returns The URL and the Git Provider it belongs to, or `null` when the
 * Source is the Registry itself.
 *
 * @remarks
 * The null is what a caller hangs a whole row on: "published here" is not worth
 * showing on a surface served by the Registry it would be naming, so a Source
 * is only worth rendering when it points somewhere the reader cannot already
 * see. Splitting that decision out of the interface keeps it testable, and
 * keeps every surface agreeing on which Sources are worth showing.
 *
 * `provider` is null for a URL at a host no Git Provider claims. An Import
 * cannot produce one — it builds the URL from the provider's own host — but a
 * hand-written publish may declare any `http(s)` URL (ADR-0041), and reporting
 * it without a provider beats claiming the wrong one.
 *
 * @example
 * ```ts
 * importedSource("https://github.com/org-quicko/skillset");
 * // -> { url: "https://github.com/org-quicko/skillset", provider: "github" }
 * importedSource("com.quicko.skills"); // -> null
 * ```
 */
export function importedSource(source: string): ImportedSource | null {
  if (!URL.canParse(source)) return null;
  const parsed = new URL(source);
  if (!/^https?:$/.test(parsed.protocol)) return null;
  return { url: source, provider: providerForHost(parsed.hostname) };
}
