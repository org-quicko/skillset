import type { ArtifactFile } from "@in-org-quicko/skillset-shared";

/**
 * Resolves a link target from a markdown document to a normalized path within
 * the Skill's Artifact.
 *
 * @param currentFilePath - The artifact path of the file containing the link
 * (e.g. "references/doc.md" or "SKILL.md").
 * @param href - The link target from the markdown (e.g. "../other.md",
 * "./guide.md", "/SKILL.md", or "references/api.md#endpoints").
 * @returns The normalized path relative to the Artifact root without a leading
 * slash, or null if the link is an external URL, mailto, or in-page anchor.
 *
 * @remarks
 * Links pointing outside the Artifact boundary via repeated `..` are clamped
 * to the Artifact root rather than escaping above it.
 *
 * @example
 * ```ts
 * resolveArtifactPath("references/doc.md", "guide.md"); // "references/guide.md"
 * resolveArtifactPath("references/doc.md", "../SKILL.md"); // "SKILL.md"
 * resolveArtifactPath("SKILL.md", "./references/api.md"); // "references/api.md"
 * resolveArtifactPath("references/doc.md", "/scripts/run.sh"); // "scripts/run.sh"
 * ```
 */
export function resolveArtifactPath(currentFilePath: string, href: string): string | null {
  const trimmed = href.trim();
  if (
    !trimmed ||
    trimmed.startsWith("#") ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ||
    trimmed.startsWith("//")
  ) {
    return null;
  }

  // Strip query string and fragment
  const pathPart = trimmed.split("#")[0].split("?")[0];
  if (!pathPart) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    decoded = pathPart;
  }

  // If path starts with "/", it is treated as root-relative to the artifact
  const isRootRelative = decoded.startsWith("/");
  const targetSegments = decoded.replace(/^\/+/, "").split("/");

  let baseSegments: string[] = [];
  if (!isRootRelative) {
    const slash = currentFilePath.lastIndexOf("/");
    const currentDir = slash === -1 ? "" : currentFilePath.slice(0, slash);
    if (currentDir) {
      baseSegments = currentDir.split("/");
    }
  }

  const resultSegments: string[] = isRootRelative ? [] : [...baseSegments];
  for (const segment of targetSegments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      resultSegments.pop();
    } else {
      resultSegments.push(segment);
    }
  }

  return resultSegments.join("/");
}

/**
 * Finds a matching file in the Artifact files list for a resolved path.
 *
 * @param files - The Artifact files list.
 * @param targetPath - The resolved target path to locate.
 * @returns The matching ArtifactFile, or undefined if no matching file exists.
 *
 * @remarks
 * Resolution attempts exact path match first, followed by appending `.md` if
 * the extension was omitted, checking directory index files (`SKILL.md`,
 * `README.md`, `index.md`), and finally falling back to a case-insensitive
 * match.
 *
 * @example
 * ```ts
 * findArtifactFile(files, "references/api.md");
 * findArtifactFile(files, "references/api"); // matches "references/api.md"
 * ```
 */
export function findArtifactFile(
  files: readonly ArtifactFile[],
  targetPath: string,
): ArtifactFile | undefined {
  if (!targetPath) return undefined;

  // 1. Exact match
  const exact = files.find((file) => file.path === targetPath);
  if (exact) return exact;

  // 2. Omitted .md extension
  const withMd = files.find((file) => file.path === `${targetPath}.md`);
  if (withMd) return withMd;

  // 3. Directory index
  const index = files.find(
    (file) =>
      file.path === `${targetPath}/SKILL.md` ||
      file.path === `${targetPath}/README.md` ||
      file.path === `${targetPath}/index.md`,
  );
  if (index) return index;

  // 4. Case-insensitive fallback
  const lower = targetPath.toLowerCase();
  return files.find(
    (file) => file.path.toLowerCase() === lower || file.path.toLowerCase() === `${lower}.md`,
  );
}
