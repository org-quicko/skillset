import { z } from "zod";
import { GIT_PROVIDER_KEYS, gitProviderConfig, isGitProvider, providerForHost } from "./git-provider.js";
import type { SkillSourceLocation } from "./skill-source-location.js";

/** One path segment of a project or a folder path: no `/`, no `%`, no traversal. */
const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * A ref name, as this Registry will accept one.
 *
 * @remarks
 * Deliberately narrower than a provider allows. This value is interpolated
 * into a pinned API URL, so the pattern is what stops a `/`, a `..`, or an `@`
 * turning a ref into a request somewhere else (ADR-0020). A ref containing `/`
 * is unreachable through a browse URL anyway — see `parseSkillSourceUrl`.
 */
export const REF_PATTERN = SEGMENT_PATTERN;

/**
 * Segments a provider reserves, which therefore cannot name a real project.
 *
 * @remarks
 * GitLab delimits a project path from what follows it with a bare `-`
 * (`/group/project/-/blob/main/file`). Without this, GitLab's permissive
 * bare-project URL shape would happily read a `blob` URL as a project four
 * segments deep, and accept a single-file link as a folder.
 */
const RESERVED_SEGMENTS = new Set([".", "..", "-"]);

/**
 * Checks a project path, segment by segment.
 *
 * @remarks
 * Percent-encoding is rejected outright rather than decoded: `%` is not in
 * `SEGMENT_PATTERN`, so `%2e%2e` and `..%2f` fail here without anyone having
 * to reason about decoding order. No provider needs an encoded project
 * segment, so nothing legitimate is lost.
 *
 * The segment-count bounds come from the provider: GitHub is pinned to exactly
 * two, GitLab is unbounded above.
 *
 * @param provider - The Git Provider the project belongs to.
 * @param project - The candidate project path.
 * @throws Error if the provider is unknown, or the path has a leading or
 * trailing slash, an empty segment, a reserved segment (`.`, `..`, `-`), a
 * segment with a character outside `[A-Za-z0-9._-]`, or the wrong number of
 * segments for that provider.
 * @example
 * ```ts
 * assertProject("github", "org-quicko/skill-registry"); // passes
 * assertProject("github", "org/repo/extra");            // throws
 * ```
 */
export function assertProject(provider: string, project: string): void {
  const config = gitProviderConfig(provider);

  if (project.startsWith("/") || project.endsWith("/")) {
    throw new Error("A project path must not start or end with a slash.");
  }

  const segments = project.split("/");
  if (segments.length < config.min_project_segments) {
    throw new Error(
      `A ${config.display_name} project path needs at least ${config.min_project_segments} segments.`,
    );
  }
  if (config.max_project_segments !== null && segments.length > config.max_project_segments) {
    throw new Error(
      `A ${config.display_name} project path has at most ${config.max_project_segments} segments.`,
    );
  }

  for (const segment of segments) {
    if (segment === "") throw new Error("A project path must not contain an empty segment.");
    if (RESERVED_SEGMENTS.has(segment)) {
      throw new Error(`"${segment}" cannot be part of a project path.`);
    }
    if (!SEGMENT_PATTERN.test(segment)) {
      throw new Error(`"${segment}" is not a valid project path segment.`);
    }
  }
}

/**
 * Checks a folder path within a project.
 *
 * @remarks
 * Unlike a project segment, a folder name may carry characters a repository
 * name may not, so this decodes each segment once and judges the result rather
 * than banning `%`. That is what catches `%2e%2e` and `%2f` — the two ways a
 * folder path could otherwise climb out of the folder it names.
 *
 * @param path - The candidate folder path; `""` means the project root.
 * @throws Error if the path has a leading or trailing slash, an empty segment,
 * a `.` or `..` segment before or after decoding, a segment that decodes to
 * something containing a slash, or malformed percent-encoding.
 * @example
 * ```ts
 * assertFolderPath("skills/code-review"); // passes
 * assertFolderPath("skills/%2e%2e/etc");  // throws
 * ```
 */
export function assertFolderPath(path: string): void {
  if (path === "") return;
  if (path.startsWith("/") || path.endsWith("/")) {
    throw new Error("A folder path must not start or end with a slash.");
  }

  for (const segment of path.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error("A folder path must not contain an empty, `.`, or `..` segment.");
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error(`"${segment}" is not a valid folder path segment.`);
    }
    if (decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\")) {
      throw new Error(`"${segment}" is not a valid folder path segment.`);
    }
  }
}

/**
 * Parses a browse URL pasted on the publish screen into the folder it names.
 *
 * @remarks
 * The provider is discovered from the URL's host, so a writer pastes a link
 * from GitHub or GitLab without telling the Registry which is which.
 *
 * Accepted shapes are the providers' own folder-browsing URLs, per
 * `GIT_PROVIDERS[provider].url_patterns`: a bare project root, which resolves
 * the default branch, and a `tree` URL naming a ref and optionally a
 * subdirectory. A `blob` URL names one file rather than a folder and is
 * refused — for GitLab that falls out of `-` being a reserved segment.
 *
 * A ref whose own name contains `/` is not supported, and cannot be: the
 * providers' URLs are ambiguous between the ref and the folder path in that
 * case, so `.../tree/release/1.0/skills` reads as ref `release` and path
 * `1.0/skills`. A writer with such a branch can still publish by uploading the
 * folder.
 *
 * @param url - The URL as pasted, untrimmed.
 * @returns The provider, project, ref, and folder path the URL names.
 * @throws Error if `url` is not a URL, its host is not a known Git Provider,
 * it matches none of that provider's accepted shapes, or the project or folder
 * path it names fails validation.
 * @example
 * Returns `{ provider: "gitlab", project: "acme/platform/skills", ref: "main", path: "code-review" }`:
 * ```ts
 * parseSkillSourceUrl("https://gitlab.com/acme/platform/skills/-/tree/main/code-review");
 * ```
 */
export function parseSkillSourceUrl(url: string): SkillSourceLocation {
  const hosts = GIT_PROVIDER_KEYS.map((provider) => gitProviderConfig(provider).host).join(" or ");
  const invalid = () =>
    new Error(
      `"${url}" isn't a repository or folder URL. Expected an https:// link on ${hosts} — ` +
        `a project's page, or its folder view (a "tree" URL).`,
    );

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw invalid();
  }

  const provider = providerForHost(parsed.hostname);
  if (!provider) throw invalid();

  for (const pattern of gitProviderConfig(provider).url_patterns) {
    const match = pattern.exec(parsed.pathname);
    if (!match) continue;

    const [, project, ref, path] = match;
    if (!project) continue;

    const location: SkillSourceLocation = {
      provider,
      project,
      ref: ref ?? null,
      path: (path ?? "").replace(/\/+$/, ""),
    };

    // A shape can match and still name something invalid — a GitLab `blob`
    // URL matches the bare-project shape, and a three-segment path matches
    // GitHub's. Validating here rather than returning means a bad URL is one
    // refusal with a reason, not a request that fails later.
    assertProject(provider, location.project);
    if (location.ref !== null && !REF_PATTERN.test(location.ref)) throw invalid();
    assertFolderPath(location.path);

    return location;
  }

  throw invalid();
}

/**
 * A `SkillSourceLocation` as it crosses the API boundary.
 *
 * @remarks
 * Parts, never a URL. The server builds every provider request from these
 * fields and will not follow anything a caller hands it, which is what keeps a
 * server-side fetch from being a request-forgery surface (ADR-0020). The
 * browser parses the pasted URL with `parseSkillSourceUrl` and sends the
 * result; the server re-validates every field.
 */
export const SkillSourceLocationSchema = z
  .object({
    provider: z.string().refine(isGitProvider, { message: "Not a Git Provider this Registry reads from." }),
    project: z.string().min(1).max(512),
    ref: z.string().min(1).max(200).regex(REF_PATTERN).nullable(),
    path: z.string().max(1024),
  })
  .superRefine((value, ctx) => {
    for (const [check, path] of [
      [() => assertProject(value.provider, value.project), "project"],
      [() => assertFolderPath(value.path), "path"],
    ] as const) {
      try {
        check();
      } catch (error) {
        ctx.addIssue({ code: "custom", message: (error as Error).message, path: [path] });
      }
    }
  });
