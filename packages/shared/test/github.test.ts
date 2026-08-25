import { describe, expect, it } from "bun:test";
import { parseGitHubSkillUrl } from "../src/index.js";

/**
 * Seam: `parseGitHubSkillUrl` is a pure function, tested table-driven the
 * same way `skill-rules.ts`'s validators already are (ticket 20, spec
 * "Testing Decisions").
 */
describe("parseGitHubSkillUrl (ticket 20)", () => {
  const acceptedCases: Array<{ name: string; url: string; expected: { owner: string; repo: string; ref: string | null; path: string } }> = [
    {
      name: "bare repository root",
      url: "https://github.com/org-quicko/skill-registry",
      expected: { owner: "org-quicko", repo: "skill-registry", ref: null, path: "" },
    },
    {
      name: "repository root with a trailing slash",
      url: "https://github.com/org-quicko/skill-registry/",
      expected: { owner: "org-quicko", repo: "skill-registry", ref: null, path: "" },
    },
    {
      name: "repository root with a .git suffix",
      url: "https://github.com/org-quicko/skill-registry.git",
      expected: { owner: "org-quicko", repo: "skill-registry", ref: null, path: "" },
    },
    {
      name: "tree URL with a nested path",
      url: "https://github.com/org-quicko/skill-registry/tree/main/skills/code-review",
      expected: { owner: "org-quicko", repo: "skill-registry", ref: "main", path: "skills/code-review" },
    },
    {
      name: "tree URL with a single-segment path",
      url: "https://github.com/org-quicko/skill-registry/tree/main/code-review",
      expected: { owner: "org-quicko", repo: "skill-registry", ref: "main", path: "code-review" },
    },
    {
      name: "tree URL with a commit SHA as ref",
      url: "https://github.com/org-quicko/skill-registry/tree/a1b2c3d4/code-review",
      expected: { owner: "org-quicko", repo: "skill-registry", ref: "a1b2c3d4", path: "code-review" },
    },
    {
      name: "tree URL with a ref and no path",
      url: "https://github.com/org-quicko/skill-registry/tree/v1.2.3",
      expected: { owner: "org-quicko", repo: "skill-registry", ref: "v1.2.3", path: "" },
    },
    {
      name: "tree URL with a ref, no path, and a trailing slash",
      url: "https://github.com/org-quicko/skill-registry/tree/v1.2.3/",
      expected: { owner: "org-quicko", repo: "skill-registry", ref: "v1.2.3", path: "" },
    },
  ];

  it.each(acceptedCases.map((c) => [c.name, c.url, c.expected] as const))(
    "accepts: %s",
    (_name, url, expected) => {
      expect(parseGitHubSkillUrl(url)).toEqual(expected);
    },
  );

  const rejectedCases: Array<{ name: string; url: string }> = [
    { name: "empty string", url: "" },
    { name: "a different host", url: "https://gitlab.com/org-quicko/skill-registry" },
    { name: "no scheme", url: "github.com/org-quicko/skill-registry" },
    { name: "a blob (single-file) URL", url: "https://github.com/org-quicko/skill-registry/blob/main/README.md" },
    { name: "missing the repo segment", url: "https://github.com/org-quicko" },
    { name: "a tree URL with no ref", url: "https://github.com/org-quicko/skill-registry/tree" },
    { name: "a tree URL with no ref, trailing slash", url: "https://github.com/org-quicko/skill-registry/tree/" },
    { name: "not a URL at all", url: "not a url" },
  ];

  it.each(rejectedCases.map((c) => [c.name, c.url] as const))("rejects: %s", (_name, url) => {
    expect(() => parseGitHubSkillUrl(url)).toThrow();
  });
});
