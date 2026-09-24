import { describe, expect, it } from "bun:test";
import {
  importedSource,
  RESOURCE_SOURCE_MAX_LENGTH,
  resourceSourceUrl,
  reverseDomain,
  SkillValidationError,
  validateResourceSource,
} from "../src/index.js";

describe("reverseDomain", () => {
  it("reverses a host's labels", () => {
    expect(reverseDomain("https://skills.quicko.com")).toBe("com.quicko.skills");
  });

  // Everything but the host is noise here: the value is an identity, and a
  // port or a path would make two deployments of one Registry read differently.
  it("drops the port, path, and scheme", () => {
    expect(reverseDomain("http://skills.quicko.com:3000/skills?q=x")).toBe("com.quicko.skills");
  });

  it("lowercases, so the same host never reads two ways", () => {
    expect(reverseDomain("https://Skills.Quicko.COM")).toBe("com.quicko.skills");
  });

  it("leaves a single-label host as itself", () => {
    expect(reverseDomain("http://localhost:3000")).toBe("localhost");
  });

  it("accepts a bare hostname, not only a URL", () => {
    expect(reverseDomain("skills.quicko.com")).toBe("com.quicko.skills");
  });

  it("refuses a value with no hostname in it", () => {
    expect(() => reverseDomain("   ")).toThrow(/Cannot read a hostname/);
  });
});

describe("resourceSourceUrl", () => {
  it("names the repository, without the ref or the folder", () => {
    expect(
      resourceSourceUrl({ provider: "github", project: "org-quicko/skillset", ref: "main", path: "skills/review" }),
    ).toBe("https://github.com/org-quicko/skillset");
  });

  it("handles a GitLab project nested under groups", () => {
    expect(resourceSourceUrl({ provider: "gitlab", project: "acme/platform/tooling", ref: null, path: "" })).toBe(
      "https://gitlab.com/acme/platform/tooling",
    );
  });

  // Two Skills out of one monorepo record the same source on purpose: the
  // repository is what they came from, and it stays right when a folder moves.
  it("gives two folders of one repository the same source", () => {
    const base = { provider: "github", project: "acme/skills", ref: "main" };
    expect(resourceSourceUrl({ ...base, path: "a" })).toBe(resourceSourceUrl({ ...base, path: "b" }));
  });

  it("refuses a provider this Registry does not read from", () => {
    expect(() => resourceSourceUrl({ provider: "bitbucket", project: "a/b", ref: null, path: "" })).toThrow();
  });
});

describe("validateResourceSource", () => {
  it("accepts an absolute https URL", () => {
    expect(validateResourceSource("https://github.com/org-quicko/skillset")).toBe(
      "https://github.com/org-quicko/skillset",
    );
  });

  it("reads an absent source as undefined rather than a failure", () => {
    expect(validateResourceSource(undefined)).toBeUndefined();
    expect(validateResourceSource(null)).toBeUndefined();
  });

  // The scheme check is what keeps a `javascript:` URL out of a field the
  // interface renders as a link.
  it.each([
    ["a non-http scheme", "javascript:alert(1)"],
    ["a data URL", "data:text/html,<script>"],
    ["a relative path", "/org-quicko/skillset"],
    ["a reverse-DNS domain, which nobody may declare", "com.quicko.skills"],
  ])("refuses %s", (_label, value) => {
    expect(() => validateResourceSource(value)).toThrow(SkillValidationError);
  });

  it("refuses a source longer than the cap", () => {
    expect(() => validateResourceSource(`https://example.com/${"a".repeat(RESOURCE_SOURCE_MAX_LENGTH)}`)).toThrow(
      SkillValidationError,
    );
  });

  it("names the rule and the field it broke", () => {
    try {
      validateResourceSource("not a url");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillValidationError);
      expect((error as SkillValidationError).rule).toBe("source_invalid");
      expect((error as SkillValidationError).field).toBe("source");
    }
  });
});

describe("importedSource", () => {
  it("reads a GitHub URL as its provider", () => {
    expect(importedSource("https://github.com/org-quicko/skillset")).toEqual({
      url: "https://github.com/org-quicko/skillset",
      provider: "github",
    });
  });

  it("reads a GitLab URL as its provider", () => {
    expect(importedSource("https://gitlab.com/acme/platform/tooling")?.provider).toBe("gitlab");
  });

  // The null is what hides the Source row: a Registry naming itself on its own
  // page tells the reader nothing they are not already looking at.
  it("reads the Registry's own reverse-DNS domain as nothing to show", () => {
    expect(importedSource("com.quicko.skills")).toBeNull();
    expect(importedSource("localhost")).toBeNull();
  });

  it("reads a non-http(s) URL as nothing to show", () => {
    expect(importedSource("javascript:alert(1)")).toBeNull();
    expect(importedSource("data:text/html,<script>")).toBeNull();
  });

  // A declared URL at an unclaimed host still names somewhere real, so it is
  // reported with no provider rather than dropped.
  it("keeps a URL whose host no Git Provider claims, with a null provider", () => {
    expect(importedSource("https://git.internal.example/team/skills")).toEqual({
      url: "https://git.internal.example/team/skills",
      provider: null,
    });
  });

  it("round-trips what resourceSourceUrl builds", () => {
    const url = resourceSourceUrl({ provider: "github", project: "org-quicko/skillset", ref: "main", path: "a" });

    expect(importedSource(url)).toEqual({ url, provider: "github" });
  });
});
