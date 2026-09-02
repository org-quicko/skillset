/**
 * Where a Skill's files live at a Git Provider.
 *
 * @remarks
 * `project` is a **path**, not an owner and a repository. GitLab has nested
 * groups, so `acme/platform/tooling/skills` is one project four segments deep,
 * and a two-field `{ owner, repo }` cannot express it (ADR-0024).
 *
 * That means `project` legitimately contains `/`, which the old
 * `GITHUB_NAME_PATTERN` was written to forbid. The traversal defence therefore
 * moves rather than weakens: `assertProject` validates every segment
 * individually, so no value here can climb out of the provider's project path
 * and address a different API route.
 */
export interface SkillSourceLocation {
  /** A key of `GIT_PROVIDERS`. */
  provider: string;
  /** `owner/repo`, or `group/subgroup/project`. Never leading or trailing `/`. */
  project: string;
  /** `null` resolves the project's default branch. */
  ref: string | null;
  /** The folder within the project. `""` is the project root. */
  path: string;
}
