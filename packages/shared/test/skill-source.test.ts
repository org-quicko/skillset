import { describe, expect, it } from "bun:test";
import { assertFolderPath, assertProject, parseSkillSourceUrl, type SkillSourceLocation } from "../src/index.js";

/**
 * Seam: `parseSkillSourceUrl` and the two validators are pure functions,
 * tested table-driven the same way `skill-rules.ts`'s validators already are.
 *
 * The cases are per provider on purpose. One implementation never proves a
 * seam — GitLab is here because its URL shape and its nested groups are what
 * force the differences into `GIT_PROVIDERS` instead of hiding in the GitHub
 * path (ADR-0024).
 */
describe("parseSkillSourceUrl", () => {
  const accepted: Array<{ name: string; url: string; expected: SkillSourceLocation }> = [
    {
      name: "GitHub: bare repository root",
      url: "https://github.com/org-quicko/skill-registry",
      expected: { provider: "github", project: "org-quicko/skill-registry", ref: null, path: "" },
    },
    {
      name: "GitHub: repository root with a trailing slash",
      url: "https://github.com/org-quicko/skill-registry/",
      expected: { provider: "github", project: "org-quicko/skill-registry", ref: null, path: "" },
    },
    {
      name: "GitHub: repository root with a .git suffix",
      url: "https://github.com/org-quicko/skill-registry.git",
      expected: { provider: "github", project: "org-quicko/skill-registry", ref: null, path: "" },
    },
    {
      name: "GitHub: tree URL with a nested path",
      url: "https://github.com/org-quicko/skill-registry/tree/main/skills/code-review",
      expected: { provider: "github", project: "org-quicko/skill-registry", ref: "main", path: "skills/code-review" },
    },
    {
      name: "GitHub: tree URL with no path is the repository root at that ref",
      url: "https://github.com/org-quicko/skill-registry/tree/main",
      expected: { provider: "github", project: "org-quicko/skill-registry", ref: "main", path: "" },
    },
    {
      name: "GitHub: a commit SHA is a ref like any other",
      url: "https://github.com/acme/skills/tree/9060628f/code-review",
      expected: { provider: "github", project: "acme/skills", ref: "9060628f", path: "code-review" },
    },
    {
      name: "GitLab: bare project root",
      url: "https://gitlab.com/acme/skills",
      expected: { provider: "gitlab", project: "acme/skills", ref: null, path: "" },
    },
    {
      name: "GitLab: a project under nested groups is one project, however deep",
      url: "https://gitlab.com/acme/platform/tooling/skills",
      expected: { provider: "gitlab", project: "acme/platform/tooling/skills", ref: null, path: "" },
    },
    {
      name: "GitLab: tree URL with a path",
      url: "https://gitlab.com/acme/platform/skills/-/tree/main/code-review",
      expected: { provider: "gitlab", project: "acme/platform/skills", ref: "main", path: "code-review" },
    },
    {
      name: "GitLab: tree URL with no path",
      url: "https://gitlab.com/acme/skills/-/tree/main",
      expected: { provider: "gitlab", project: "acme/skills", ref: "main", path: "" },
    },
    {
      name: "GitLab: project root with a .git suffix",
      url: "https://gitlab.com/acme/skills.git",
      expected: { provider: "gitlab", project: "acme/skills", ref: null, path: "" },
    },
  ];

  for (const { name, url, expected } of accepted) {
    it(`accepts ${name}`, () => {
      expect(parseSkillSourceUrl(url)).toEqual(expected);
    });
  }

  const rejected: Array<{ name: string; url: string }> = [
    { name: "a host that is not a Git Provider", url: "https://bitbucket.org/acme/skills" },
    { name: "a host that merely looks like one", url: "https://github.com.evil.example/acme/skills" },
    { name: "a GitHub blob URL, which names one file rather than a folder", url: "https://github.com/a/b/blob/main/SKILL.md" },
    { name: "a GitLab blob URL", url: "https://gitlab.com/acme/skills/-/blob/main/SKILL.md" },
    { name: "a GitLab raw URL", url: "https://gitlab.com/acme/skills/-/raw/main/SKILL.md" },
    { name: "a bare owner/repo with no scheme", url: "org-quicko/skill-registry" },
    { name: "a GitHub tree URL naming no ref", url: "https://github.com/acme/skills/tree" },
    { name: "a GitHub tree URL naming no ref, with a trailing slash", url: "https://github.com/acme/skills/tree/" },
    { name: "a GitHub project with a third segment", url: "https://github.com/acme/skills/extra" },
    { name: "a GitLab project of one segment", url: "https://gitlab.com/acme" },
    { name: "percent-encoded traversal in the project path", url: "https://github.com/acme/%2e%2e" },
    { name: "an empty string", url: "" },
    { name: "a plain word", url: "skills" },
  ];

  for (const { name, url } of rejected) {
    it(`rejects ${name}`, () => {
      expect(() => parseSkillSourceUrl(url)).toThrow();
    });
  }

  it("names both hosts in the refusal, so a writer knows what was expected", () => {
    expect(() => parseSkillSourceUrl("https://bitbucket.org/a/b")).toThrow(/github\.com or gitlab\.com/);
  });
});

/**
 * The traversal defence. `project` permits `/` because a GitLab project path
 * needs it, so the guarantee ADR-0020 rests on — no caller-supplied value can
 * address a different API route — is carried entirely by these two functions.
 */
describe("assertProject", () => {
  it("accepts an owner/repo for GitHub and a nested group path for GitLab", () => {
    expect(() => assertProject("github", "org-quicko/skill-registry")).not.toThrow();
    expect(() => assertProject("gitlab", "acme/platform/tooling/skills")).not.toThrow();
  });

  it("holds GitHub to exactly two segments and GitLab to at least two", () => {
    expect(() => assertProject("github", "acme")).toThrow();
    expect(() => assertProject("github", "acme/skills/extra")).toThrow();
    expect(() => assertProject("gitlab", "acme")).toThrow();
  });

  const bad = [
    { name: "a leading slash", project: "/acme/skills" },
    { name: "a trailing slash", project: "acme/skills/" },
    { name: "an empty segment", project: "acme//skills" },
    { name: "a dot segment", project: "acme/./skills" },
    { name: "a dot-dot segment", project: "acme/../skills" },
    // GitLab's own delimiter. Without this, its permissive bare-project shape
    // would read a blob URL as a project several segments deep.
    { name: "GitLab's reserved dash segment", project: "acme/skills/-/blob" },
    { name: "percent-encoded dot-dot", project: "acme/%2e%2e" },
    { name: "percent-encoded slash", project: "acme/a%2Fb" },
    { name: "an at sign", project: "acme@evil.example/skills" },
    { name: "a colon", project: "acme:8080/skills" },
  ];

  for (const { name, project } of bad) {
    it(`rejects ${name}`, () => {
      expect(() => assertProject("gitlab", project)).toThrow();
    });
  }

  it("throws on a provider it does not know, which is a caller bug", () => {
    expect(() => assertProject("bitbucket", "acme/skills")).toThrow(/Unknown Git Provider/);
  });
});

describe("assertFolderPath", () => {
  it("accepts the project root and a nested folder", () => {
    expect(() => assertFolderPath("")).not.toThrow();
    expect(() => assertFolderPath("skills/code-review")).not.toThrow();
  });

  it("accepts a folder name that needs encoding, which a project segment may not", () => {
    // A folder is not a repository name: `%20` is a legitimate space here.
    expect(() => assertFolderPath("skills/code%20review")).not.toThrow();
  });

  const bad = [
    { name: "a leading slash", path: "/skills" },
    { name: "a trailing slash", path: "skills/" },
    { name: "an empty segment", path: "skills//code-review" },
    { name: "a dot segment", path: "skills/./code-review" },
    { name: "a dot-dot segment", path: "skills/../../etc" },
    { name: "percent-encoded dot-dot", path: "skills/%2e%2e/etc" },
    { name: "percent-encoded slash", path: "skills/a%2Fb" },
    { name: "percent-encoded backslash", path: "skills/a%5Cb" },
    { name: "malformed percent-encoding", path: "skills/%zz" },
  ];

  for (const { name, path } of bad) {
    it(`rejects ${name}`, () => {
      expect(() => assertFolderPath(path)).toThrow();
    });
  }
});
