/** Where a signed-out visitor lands, and the only path that renders `LoginForm`. */
export const LOGIN_PATH = "/login";

/** The URL path prefix every Skill detail page sits under. */
export const SKILL_PATH_PREFIX = "/skills/";

/**
 * The URL path for a Skill's detail page.
 *
 * @param name - The Skill's name, percent-encoded into the path.
 * @returns A root-relative path like `/skills/my-skill`.
 */
export function skillPath(name: string): string {
  return `${SKILL_PATH_PREFIX}${encodeURIComponent(name)}`;
}
