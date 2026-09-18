import { describe, expect, it } from "bun:test";
import {
  discoverSkillFolders,
  readSkillFolder,
  SkillFolderError,
  type SkillFolderReason,
  type SkillSourceLocation,
} from "../src/index.js";

const GITHUB: SkillSourceLocation = {
  provider: "github",
  project: "acme/skills",
  ref: "main",
  path: "code-review",
};
const CONTENTS = "https://api.github.com/repos/acme/skills/contents/code-review?ref=main";
const RAW = "https://raw.githubusercontent.com/acme/skills/main/code-review";

const GITLAB: SkillSourceLocation = {
  provider: "gitlab",
  project: "acme/platform/skills",
  ref: "main",
  path: "code-review",
};
const GL_API = "https://gitlab.com/api/v4/projects/acme%2Fplatform%2Fskills/repository";
const GL_TREE = (page: number) =>
  `${GL_API}/tree?recursive=true&per_page=100&page=${page}&ref=main&path=code-review`;
const glBlob = (path: string) => `${GL_API}/files/${encodeURIComponent(path)}/raw?ref=main`;

/** A GitHub Contents API file entry, with the fields the walk actually reads. */
function file(path: string, size = 12): Record<string, unknown> {
  return { path, type: "file", size, download_url: `https://raw.githubusercontent.com/acme/skills/main/${path}` };
}

interface Stub {
  fetch: typeof fetch;
  /** Every URL requested, in order — the walk is serial, so order is meaningful. */
  urls: string[];
  bearers: string[];
  userAgents: (string | null)[];
  redirects: (RequestRedirect | undefined)[];
}

/**
 * A `fetch` answering from a fixture map: a `Uint8Array` is served as bytes, a
 * `Response` verbatim, anything else as JSON. Unmapped URLs 404, which is what
 * makes "it never asked for that" an assertable outcome.
 */
function stub(routes: Record<string, unknown>): Stub {
  const result: Stub = { fetch: null as never, urls: [], bearers: [], userAgents: [], redirects: [] };

  result.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    result.urls.push(url);
    result.userAgents.push(headers.get("user-agent"));
    result.redirects.push(init?.redirect);
    const authorization = headers.get("authorization");
    if (authorization) result.bearers.push(authorization.replace(/^Bearer /, ""));

    const body = routes[url];
    if (body === undefined) return new Response("not found", { status: 404 });
    if (body instanceof Response) return body;
    // Re-wrapped to narrow `ArrayBufferLike` to a concrete `ArrayBuffer`-backed
    // view, which is what `BodyInit` accepts.
    if (body instanceof Uint8Array) return new Response(new Blob([new Uint8Array(body)]), { status: 200 });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  return result;
}

/** Asserts the call rejects with a `SkillFolderError` carrying `reason`. */
async function expectReason(promise: Promise<unknown>, reason: SkillFolderReason): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SkillFolderError);
    expect((error as SkillFolderError).reason).toBe(reason);
    return;
  }
  throw new Error(`Expected a SkillFolderError with reason "${reason}", but it resolved.`);
}

/**
 * Seam: the module's own interface. A fake `fetch` is passed in rather than the
 * global reassigned, so nothing here touches process-wide state and no request
 * leaves.
 *
 * What is deliberately not tested is a real round trip: that would test GitHub
 * and GitLab. What is tested is the walk this Registry is responsible for — the
 * shape it returns, the limits it enforces, and the one URL it does not build
 * itself (ADR-0020).
 */
describe("Reading a Skill folder from GitHub", () => {
  it("returns files at paths relative to the folder, not the repository root", async () => {
    const github = stub({
      [CONTENTS]: [file("code-review/SKILL.md")],
      [`${RAW}/SKILL.md`]: new TextEncoder().encode("hello world!"),
    });

    const files = await readSkillFolder(GITHUB, { fetch: github.fetch });

    expect(files).toHaveLength(1);
    // The same shape a dropped folder produces, so it feeds buildSkillBundle unchanged.
    expect(files[0]?.path).toBe("SKILL.md");
    expect(new TextDecoder().decode(files[0]?.bytes)).toBe("hello world!");
  });

  it("recurses into subdirectories", async () => {
    const github = stub({
      [CONTENTS]: [file("code-review/SKILL.md"), { path: "code-review/refs", type: "dir", download_url: null }],
      "https://api.github.com/repos/acme/skills/contents/code-review/refs?ref=main": [
        file("code-review/refs/style.md"),
      ],
      [`${RAW}/SKILL.md`]: new TextEncoder().encode("root"),
      [`${RAW}/refs/style.md`]: new TextEncoder().encode("nested"),
    });

    const files = await readSkillFolder(GITHUB, { fetch: github.fetch });

    expect(files.map((entry) => entry.path).sort()).toEqual(["SKILL.md", "refs/style.md"]);
  });

  it("sends the token as a bearer when given one, and no authorization header when not", async () => {
    const routes = { [CONTENTS]: [file("code-review/SKILL.md")], [`${RAW}/SKILL.md`]: new Uint8Array([1]) };

    const authenticated = stub(routes);
    await readSkillFolder(GITHUB, { fetch: authenticated.fetch, token: "gho_writer_token" });
    expect(new Set(authenticated.bearers)).toEqual(new Set(["gho_writer_token"]));

    const anonymous = stub(routes);
    await readSkillFolder(GITHUB, { fetch: anonymous.fetch });
    expect(anonymous.bearers).toEqual([]);
  });

  it("talks to GitHub's hosts only, identifies itself, and never follows a redirect", async () => {
    const github = stub({
      [CONTENTS]: [file("code-review/SKILL.md")],
      [`${RAW}/SKILL.md`]: new Uint8Array([1]),
    });

    await readSkillFolder(GITHUB, { fetch: github.fetch });

    expect(
      github.urls.every(
        (url) => url.startsWith("https://api.github.com/") || url.startsWith("https://raw.githubusercontent.com/"),
      ),
    ).toBe(true);
    expect(new Set(github.userAgents)).toEqual(new Set(["skillset"]));
    // A fixed host that follows a redirect is not a fixed host.
    expect(new Set(github.redirects)).toEqual(new Set(["manual" as RequestRedirect]));
  });

  it("refuses a download_url that points off raw.githubusercontent.com", async () => {
    const github = stub({
      [CONTENTS]: [
        // GitHub would never send this. The check exists because it is the one
        // URL the walk does not build itself (ADR-0020).
        { path: "code-review/SKILL.md", type: "file", size: 12, download_url: "https://evil.example.com/payload" },
      ],
    });

    await expectReason(readSkillFolder(GITHUB, { fetch: github.fetch }), "untrusted_download_host");
    expect(github.urls).not.toContain("https://evil.example.com/payload");
  });

  it("drops symlinks and submodules, as the publishing pipeline already does", async () => {
    const github = stub({
      [CONTENTS]: [
        { path: "code-review/link", type: "symlink", download_url: null },
        { path: "code-review/vendor", type: "submodule", download_url: null },
      ],
    });

    await expectReason(readSkillFolder(GITHUB, { fetch: github.fetch }), "empty_folder");
  });

  it("resolves the default branch when the location names no ref", async () => {
    const github = stub({
      "https://api.github.com/repos/acme/skills": { default_branch: "trunk" },
      "https://api.github.com/repos/acme/skills/contents/code-review?ref=trunk": [],
    });

    await expectReason(readSkillFolder({ ...GITHUB, ref: null }, { fetch: github.fetch }), "empty_folder");
    expect(github.urls).toContain("https://api.github.com/repos/acme/skills/contents/code-review?ref=trunk");
  });
});

/**
 * GitLab is not a second copy of the GitHub walk. Its tree endpoint is
 * recursive, so one listing serves the whole folder; it pages that listing; and
 * it reports no per-file size, which is why the byte ceiling is charged as
 * bytes arrive rather than before the fetch.
 */
describe("Reading a Skill folder from GitLab", () => {
  it("returns files at paths relative to the folder, from one recursive listing", async () => {
    const gitlab = stub({
      [GL_TREE(1)]: [
        { path: "code-review/SKILL.md", type: "blob" },
        { path: "code-review/refs", type: "tree" },
        { path: "code-review/refs/style.md", type: "blob" },
      ],
      [glBlob("code-review/SKILL.md")]: new TextEncoder().encode("root"),
      [glBlob("code-review/refs/style.md")]: new TextEncoder().encode("nested"),
    });

    const files = await readSkillFolder(GITLAB, { fetch: gitlab.fetch });

    expect(files.map((entry) => entry.path).sort()).toEqual(["SKILL.md", "refs/style.md"]);
    // One listing, not one per directory: the recursive tree is the whole walk.
    expect(gitlab.urls.filter((url) => url.includes("/tree?"))).toHaveLength(1);
  });

  it("follows the tree listing's pages", async () => {
    const gitlab = stub({
      [GL_TREE(1)]: new Response(JSON.stringify([{ path: "code-review/a.md", type: "blob" }]), {
        status: 200,
        headers: { "content-type": "application/json", "x-next-page": "2" },
      }),
      [GL_TREE(2)]: [{ path: "code-review/b.md", type: "blob" }],
      [glBlob("code-review/a.md")]: new Uint8Array([1]),
      [glBlob("code-review/b.md")]: new Uint8Array([2]),
    });

    const files = await readSkillFolder(GITLAB, { fetch: gitlab.fetch });

    expect(files.map((entry) => entry.path).sort()).toEqual(["a.md", "b.md"]);
  });

  it("drops trees and submodules, keeping only blobs", async () => {
    const gitlab = stub({
      [GL_TREE(1)]: [
        { path: "code-review/refs", type: "tree" },
        { path: "code-review/vendor", type: "commit" },
      ],
    });

    await expectReason(readSkillFolder(GITLAB, { fetch: gitlab.fetch }), "empty_folder");
  });

  it("resolves the default branch when the location names no ref", async () => {
    const gitlab = stub({
      "https://gitlab.com/api/v4/projects/acme%2Fplatform%2Fskills": { default_branch: "trunk" },
      [`${GL_API}/tree?recursive=true&per_page=100&page=1&ref=trunk&path=code-review`]: [],
    });

    await expectReason(readSkillFolder({ ...GITLAB, ref: null }, { fetch: gitlab.fetch }), "empty_folder");
  });

  it("talks to GitLab's API host only, and never follows a redirect", async () => {
    const gitlab = stub({
      [GL_TREE(1)]: [{ path: "code-review/SKILL.md", type: "blob" }],
      [glBlob("code-review/SKILL.md")]: new Uint8Array([1]),
    });

    await readSkillFolder(GITLAB, { fetch: gitlab.fetch });

    expect(gitlab.urls.every((url) => url.startsWith("https://gitlab.com/api/v4/"))).toBe(true);
    expect(new Set(gitlab.redirects)).toEqual(new Set(["manual" as RequestRedirect]));
  });

  it("refuses an oversized project from the listing, without paging further", async () => {
    // The listing is where this walk has to enforce the entry ceiling: waiting
    // for the per-file check would mean holding the whole project in memory to
    // discover it is too big.
    const blobs = Array.from({ length: 5 }, (_, index) => ({
      path: `code-review/${index}.md`,
      type: "blob" as const,
    }));
    const gitlab = stub({
      [GL_TREE(1)]: new Response(JSON.stringify(blobs), {
        status: 200,
        headers: { "content-type": "application/json", "x-next-page": "2" },
      }),
      [GL_TREE(2)]: blobs,
    });

    await expectReason(readSkillFolder(GITLAB, { fetch: gitlab.fetch, maxFiles: 3 }), "too_many_entries");
    // Refused on the first page: the second was never asked for, and no file
    // bytes were fetched.
    expect(gitlab.urls).toEqual([GL_TREE(1)]);
  });

  it("stops paging when the page pointer does not advance", async () => {
    // A provider that keeps answering "next page: 1" is a bug or a hostile
    // response, and following it is an unbounded loop either way.
    const gitlab = stub({
      [GL_TREE(1)]: new Response(JSON.stringify([{ path: "code-review/a.md", type: "blob" }]), {
        status: 200,
        headers: { "content-type": "application/json", "x-next-page": "1" },
      }),
      [glBlob("code-review/a.md")]: new Uint8Array([1]),
    });

    const files = await readSkillFolder(GITLAB, { fetch: gitlab.fetch });

    expect(files.map((entry) => entry.path)).toEqual(["a.md"]);
    expect(gitlab.urls.filter((url) => url.includes("/tree?"))).toHaveLength(1);
  });

  it("charges the byte ceiling as bytes arrive, since the tree declares no size", async () => {
    const gitlab = stub({
      [GL_TREE(1)]: [
        { path: "code-review/a.md", type: "blob" },
        { path: "code-review/b.md", type: "blob" },
      ],
      [glBlob("code-review/a.md")]: new Uint8Array(800),
      [glBlob("code-review/b.md")]: new Uint8Array(800),
    });

    await expectReason(
      readSkillFolder(GITLAB, { fetch: gitlab.fetch, maxBytes: 1_000 }),
      "uncompressed_too_large",
    );
  });
});

describe("the ceilings a Skill is held to", () => {
  it("refuses more files than a Skill may contain, before fetching the one that breaks it", async () => {
    const github = stub({
      [CONTENTS]: [file("code-review/a.md"), file("code-review/b.md")],
      [`${RAW}/a.md`]: new Uint8Array([1]),
      [`${RAW}/b.md`]: new Uint8Array([1]),
    });

    await expectReason(readSkillFolder(GITHUB, { fetch: github.fetch, maxFiles: 1 }), "too_many_entries");
    // Counted before fetching: the second file's bytes were never requested.
    expect(github.urls).not.toContain(`${RAW}/b.md`);
  });

  it("refuses a folder larger than a Skill may be, before fetching it", async () => {
    const github = stub({
      [CONTENTS]: [file("code-review/big.md", 5_000)],
      [`${RAW}/big.md`]: new Uint8Array([1]),
    });

    await expectReason(readSkillFolder(GITHUB, { fetch: github.fetch, maxBytes: 1_000 }), "uncompressed_too_large");
    // GitHub declares each size in the listing, so nothing is pulled into memory.
    expect(github.urls).not.toContain(`${RAW}/big.md`);
  });

  it("applies the Artifact's own limits when the caller names none", async () => {
    // The defaults are the point: neither caller passes these, so a ceiling
    // cannot be dropped by omission. 1001 entries is one past
    // ARTIFACT_MAX_ENTRIES.
    const entries = Array.from({ length: 1_001 }, (_, index) => file(`code-review/${index}.md`, 0));
    const github = stub({
      [CONTENTS]: entries,
      ...Object.fromEntries(
        entries.map((entry) => [`${RAW}/${(entry.path as string).split("/")[1]}`, new Uint8Array([1])]),
      ),
    });

    await expectReason(readSkillFolder(GITHUB, { fetch: github.fetch }), "too_many_entries");
  });
});

describe("what a provider's refusals mean", () => {
  it("reads a 404 as not found", async () => {
    await expectReason(readSkillFolder(GITHUB, { fetch: stub({}).fetch }), "not_found");
    await expectReason(readSkillFolder(GITLAB, { fetch: stub({}).fetch }), "not_found");
  });

  it("tells a rate limit apart from a refusal, though both are 403", async () => {
    const limited = stub({
      [CONTENTS]: new Response("rate limited", { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
    });
    await expectReason(readSkillFolder(GITHUB, { fetch: limited.fetch }), "rate_limited");

    // A token is thousands of requests an hour, not unlimited, so this is
    // reachable on the credentialed path too — where "reconnect" fixes nothing.
    const withToken = stub({
      [CONTENTS]: new Response("rate limited", { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
    });
    await expectReason(readSkillFolder(GITHUB, { fetch: withToken.fetch, token: "gho_token" }), "rate_limited");
  });

  it("reads GitLab's own rate-limit spellings", async () => {
    // GitLab says `ratelimit-remaining`, without the `x-`, and answers 429.
    const byHeader = stub({
      [GL_TREE(1)]: new Response("slow down", { status: 403, headers: { "ratelimit-remaining": "0" } }),
    });
    await expectReason(readSkillFolder(GITLAB, { fetch: byHeader.fetch }), "rate_limited");

    const byStatus = stub({ [GL_TREE(1)]: new Response("slow down", { status: 429 }) });
    await expectReason(readSkillFolder(GITLAB, { fetch: byStatus.fetch }), "rate_limited");
  });

  it("reads a 401 or a non-rate-limited 403 as unauthorized", async () => {
    const unauthorized = stub({ [CONTENTS]: new Response("nope", { status: 401 }) });
    await expectReason(readSkillFolder(GITHUB, { fetch: unauthorized.fetch }), "unauthorized");

    const forbidden = stub({
      [CONTENTS]: new Response("nope", { status: 403, headers: { "x-ratelimit-remaining": "57" } }),
    });
    await expectReason(readSkillFolder(GITHUB, { fetch: forbidden.fetch }), "unauthorized");
  });

  it("reads anything else, including an opaque redirect, as a failed request", async () => {
    const failed = stub({ [CONTENTS]: new Response("boom", { status: 500 }) });
    await expectReason(readSkillFolder(GITHUB, { fetch: failed.fetch }), "request_failed");

    // What `redirect: "manual"` yields in a browser: status 0, not ok. The
    // refusal is the intent — a fixed host that follows a redirect is not one.
    const opaque = stub({ [CONTENTS]: Response.error() });
    await expectReason(readSkillFolder(GITHUB, { fetch: opaque.fetch }), "request_failed");
  });

  it("names the provider in the message, so a refusal says who refused", async () => {
    const gitlab = stub({ [GL_TREE(1)]: new Response("boom", { status: 500 }) });
    await expect(readSkillFolder(GITLAB, { fetch: gitlab.fetch })).rejects.toThrow(/GitLab/);
  });

  it("throws rather than refuses on a provider it does not know, which is a caller bug", async () => {
    await expect(
      readSkillFolder({ ...GITHUB, provider: "bitbucket" }, { fetch: stub({}).fetch }),
    ).rejects.toThrow(/Unknown Git Provider/);
  });
});

/**
 * `discoverSkillFolders` is `readSkillFolder`'s companion for a location that
 * may hold more than one Skill — a repository root, or a folder several
 * Skills sit inside.
 */
describe("Finding every Skill folder under a location", () => {
  const ROOT_GITHUB: SkillSourceLocation = { provider: "github", project: "acme/skills", ref: "main", path: "" };
  const rootContents = (path: string) => `https://api.github.com/repos/acme/skills/contents/${path}?ref=main`;
  const dir = (path: string): Record<string, unknown> => ({ path, type: "dir", download_url: null });

  const ROOT_GITLAB: SkillSourceLocation = {
    provider: "gitlab",
    project: "acme/platform/skills",
    ref: "main",
    path: "",
  };
  const ROOT_GL_API = "https://gitlab.com/api/v4/projects/acme%2Fplatform%2Fskills/repository";
  const rootTree = (page: number) => `${ROOT_GL_API}/tree?recursive=true&per_page=100&page=${page}&ref=main&path=`;

  describe("on GitHub", () => {
    it("returns exactly the given folder when it itself holds a SKILL.md, and walks no further", async () => {
      const github = stub({ [rootContents("")]: [file("SKILL.md"), dir("other")] });

      const found = await discoverSkillFolders(ROOT_GITHUB, { fetch: github.fetch });

      expect(found).toEqual([{ ...ROOT_GITHUB, path: "", ref: "main" }]);
      expect(github.urls).toEqual([rootContents("")]);
    });

    it("finds every Skill folder without descending into one it already found", async () => {
      const github = stub({
        [rootContents("")]: [dir("apps"), file("README.md")],
        [rootContents("apps")]: [dir("apps/code-review"), dir("apps/pdf-tools")],
        [rootContents("apps/code-review")]: [file("apps/code-review/SKILL.md"), dir("apps/code-review/refs")],
        [rootContents("apps/pdf-tools")]: [file("apps/pdf-tools/SKILL.md")],
      });

      const found = await discoverSkillFolders(ROOT_GITHUB, { fetch: github.fetch });

      expect(found.map((location) => location.path).sort()).toEqual(["apps/code-review", "apps/pdf-tools"]);
      expect(github.urls).not.toContain(rootContents("apps/code-review/refs"));
    });

    it("finds a Skill exactly three levels below the starting folder", async () => {
      const github = stub({
        [rootContents("")]: [dir("a")],
        [rootContents("a")]: [dir("a/b")],
        [rootContents("a/b")]: [dir("a/b/c")],
        [rootContents("a/b/c")]: [file("a/b/c/SKILL.md")],
      });

      const found = await discoverSkillFolders(ROOT_GITHUB, { fetch: github.fetch });

      expect(found.map((location) => location.path)).toEqual(["a/b/c"]);
    });

    it("does not look past the depth limit", async () => {
      const github = stub({
        [rootContents("")]: [dir("a")],
        [rootContents("a")]: [dir("a/b")],
        [rootContents("a/b")]: [dir("a/b/c")],
        [rootContents("a/b/c")]: [dir("a/b/c/d")],
        [rootContents("a/b/c/d")]: [file("a/b/c/d/SKILL.md")],
      });

      await expectReason(discoverSkillFolders(ROOT_GITHUB, { fetch: github.fetch }), "empty_folder");
      expect(github.urls).not.toContain(rootContents("a/b/c/d"));
    });

    it("skips version-control, dependency, and dotfile directories", async () => {
      const github = stub({
        [rootContents("")]: [dir(".git"), dir("node_modules"), dir("skills")],
        [rootContents("skills")]: [file("skills/SKILL.md")],
      });

      const found = await discoverSkillFolders(ROOT_GITHUB, { fetch: github.fetch });

      expect(found.map((location) => location.path)).toEqual(["skills"]);
      expect(github.urls).not.toContain(rootContents(".git"));
      expect(github.urls).not.toContain(rootContents("node_modules"));
    });

    it("refuses a project wide enough to need more directory requests than the walk will make", async () => {
      // Depth alone does not bound a wide tree: three directories at the same
      // level is already one request over a ceiling of three (the root's own
      // listing counts as the first).
      const github = stub({
        [rootContents("")]: [dir("a"), dir("b"), dir("c")],
        [rootContents("a")]: [file("a/x.md")],
        [rootContents("b")]: [file("b/x.md")],
        [rootContents("c")]: [file("c/x.md")],
      });

      await expectReason(discoverSkillFolders(ROOT_GITHUB, { fetch: github.fetch, maxFiles: 3 }), "too_many_entries");
      // Refused on the request that would have exceeded the ceiling: the
      // fourth directory (the root plus its first two children) is never
      // actually requested.
      expect(github.urls).toHaveLength(3);
    });

    it("throws empty_folder when no Skill is found", async () => {
      const github = stub({ [rootContents("")]: [file("README.md")] });
      await expectReason(discoverSkillFolders(ROOT_GITHUB, { fetch: github.fetch }), "empty_folder");
    });

    it("resolves the default branch and carries it on every result", async () => {
      const github = stub({
        "https://api.github.com/repos/acme/skills": { default_branch: "trunk" },
        "https://api.github.com/repos/acme/skills/contents/?ref=trunk": [file("SKILL.md")],
      });

      const found = await discoverSkillFolders({ ...ROOT_GITHUB, ref: null }, { fetch: github.fetch });

      expect(found).toEqual([{ ...ROOT_GITHUB, path: "", ref: "trunk" }]);
    });
  });

  describe("on GitLab", () => {
    it("returns exactly the given folder when it itself holds a SKILL.md, from one listing", async () => {
      const gitlab = stub({
        [rootTree(1)]: [
          { path: "SKILL.md", type: "blob" },
          { path: "other", type: "tree" },
        ],
      });

      const found = await discoverSkillFolders(ROOT_GITLAB, { fetch: gitlab.fetch });

      expect(found).toEqual([{ ...ROOT_GITLAB, path: "", ref: "main" }]);
    });

    it("finds every Skill folder, dropping any nested inside another", async () => {
      const gitlab = stub({
        [rootTree(1)]: [
          { path: "apps/code-review/SKILL.md", type: "blob" },
          { path: "apps/code-review/refs/SKILL.md", type: "blob" },
          { path: "apps/pdf-tools/SKILL.md", type: "blob" },
        ],
      });

      const found = await discoverSkillFolders(ROOT_GITLAB, { fetch: gitlab.fetch });

      expect(found.map((location) => location.path).sort()).toEqual(["apps/code-review", "apps/pdf-tools"]);
    });

    it("finds a Skill exactly at the depth limit, but not past it", async () => {
      const atLimit = stub({ [rootTree(1)]: [{ path: "a/b/c/SKILL.md", type: "blob" }] });
      const found = await discoverSkillFolders(ROOT_GITLAB, { fetch: atLimit.fetch });
      expect(found.map((location) => location.path)).toEqual(["a/b/c"]);

      const pastLimit = stub({ [rootTree(1)]: [{ path: "a/b/c/d/SKILL.md", type: "blob" }] });
      await expectReason(discoverSkillFolders(ROOT_GITLAB, { fetch: pastLimit.fetch }), "empty_folder");
    });

    it("skips dependency and dotfile directories", async () => {
      const gitlab = stub({
        [rootTree(1)]: [
          { path: "node_modules/left-pad/SKILL.md", type: "blob" },
          { path: ".git/SKILL.md", type: "blob" },
          { path: "skills/SKILL.md", type: "blob" },
        ],
      });

      const found = await discoverSkillFolders(ROOT_GITLAB, { fetch: gitlab.fetch });

      expect(found.map((location) => location.path)).toEqual(["skills"]);
    });

    it("refuses a project holding more entries than the walk will search", async () => {
      const entries = Array.from({ length: 5 }, (_, index) => ({ path: `skills/${index}/x.md`, type: "blob" as const }));
      const gitlab = stub({ [rootTree(1)]: entries });

      await expectReason(discoverSkillFolders(ROOT_GITLAB, { fetch: gitlab.fetch, maxFiles: 3 }), "too_many_entries");
    });

    it("throws empty_folder when no Skill is found", async () => {
      const gitlab = stub({ [rootTree(1)]: [{ path: "README.md", type: "blob" }] });
      await expectReason(discoverSkillFolders(ROOT_GITLAB, { fetch: gitlab.fetch }), "empty_folder");
    });
  });

  it("throws rather than refuses on a provider it does not know, which is a caller bug", async () => {
    await expect(
      discoverSkillFolders({ ...ROOT_GITHUB, provider: "bitbucket" }, { fetch: stub({}).fetch }),
    ).rejects.toThrow(/Unknown Git Provider/);
  });
});
