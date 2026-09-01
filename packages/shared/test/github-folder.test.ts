import { describe, expect, it } from "bun:test";
import {
  GitHubFolderError,
  readGitHubFolder,
  type GitHubFolderReason,
  type GitHubSkillLocation,
} from "../src/index.js";

const LOCATION: GitHubSkillLocation = { owner: "acme", repo: "skills", ref: "main", path: "code-review" };
const CONTENTS = "https://api.github.com/repos/acme/skills/contents/code-review?ref=main";
const RAW = "https://raw.githubusercontent.com/acme/skills/main/code-review";

/** A Contents API file entry, with the fields the walk actually reads. */
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
function stubGitHub(routes: Record<string, unknown>): Stub {
  const stub: Stub = { fetch: null as never, urls: [], bearers: [], userAgents: [], redirects: [] };

  stub.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    stub.urls.push(url);
    stub.userAgents.push(headers.get("user-agent"));
    stub.redirects.push(init?.redirect);
    const authorization = headers.get("authorization");
    if (authorization) stub.bearers.push(authorization.replace(/^Bearer /, ""));

    const body = routes[url];
    if (body === undefined) return new Response("not found", { status: 404 });
    if (body instanceof Response) return body;
    // Re-wrapped to narrow `ArrayBufferLike` to a concrete `ArrayBuffer`-backed
    // view, which is what `BodyInit` accepts.
    if (body instanceof Uint8Array) return new Response(new Blob([new Uint8Array(body)]), { status: 200 });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  return stub;
}

/** Asserts the call rejects with a `GitHubFolderError` carrying `reason`. */
async function expectReason(promise: Promise<unknown>, reason: GitHubFolderReason): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(GitHubFolderError);
    expect((error as GitHubFolderError).reason).toBe(reason);
    return;
  }
  throw new Error(`Expected a GitHubFolderError with reason "${reason}", but it resolved.`);
}

/**
 * Seam: the module's own interface. A fake `fetch` is passed in rather than
 * the global reassigned, so nothing here touches process-wide state and no
 * request leaves.
 *
 * What is deliberately not tested is a real GitHub round trip: that would test
 * GitHub. What is tested is the walk this Registry is responsible for — the
 * shape it returns, the limits it enforces, and the one URL it did not build
 * itself (ADR-0020).
 */
describe("Reading a Skill folder from GitHub", () => {
  it("returns files at paths relative to the folder, not the repository root", async () => {
    const stub = stubGitHub({
      [CONTENTS]: [file("code-review/SKILL.md")],
      [`${RAW}/SKILL.md`]: new TextEncoder().encode("hello world!"),
    });

    const files = await readGitHubFolder(LOCATION, { fetch: stub.fetch });

    expect(files).toHaveLength(1);
    // The same shape a dropped folder produces, so it feeds buildSkillBundle unchanged.
    expect(files[0]?.path).toBe("SKILL.md");
    expect(new TextDecoder().decode(files[0]?.bytes)).toBe("hello world!");
  });

  it("recurses into subdirectories", async () => {
    const stub = stubGitHub({
      [CONTENTS]: [file("code-review/SKILL.md"), { path: "code-review/refs", type: "dir", download_url: null }],
      "https://api.github.com/repos/acme/skills/contents/code-review/refs?ref=main": [
        file("code-review/refs/style.md"),
      ],
      [`${RAW}/SKILL.md`]: new TextEncoder().encode("root"),
      [`${RAW}/refs/style.md`]: new TextEncoder().encode("nested"),
    });

    const files = await readGitHubFolder(LOCATION, { fetch: stub.fetch });

    expect(files.map((f) => f.path).sort()).toEqual(["SKILL.md", "refs/style.md"]);
  });

  it("sends the token as a bearer when given one, and no authorization header when not", async () => {
    const routes = { [CONTENTS]: [file("code-review/SKILL.md")], [`${RAW}/SKILL.md`]: new Uint8Array([1]) };

    const authenticated = stubGitHub(routes);
    await readGitHubFolder(LOCATION, { fetch: authenticated.fetch, token: "gho_writer_token" });
    expect(new Set(authenticated.bearers)).toEqual(new Set(["gho_writer_token"]));

    const anonymous = stubGitHub(routes);
    await readGitHubFolder(LOCATION, { fetch: anonymous.fetch });
    expect(anonymous.bearers).toEqual([]);
  });

  it("talks to GitHub's hosts only, identifies itself, and never follows a redirect", async () => {
    const stub = stubGitHub({
      [CONTENTS]: [file("code-review/SKILL.md")],
      [`${RAW}/SKILL.md`]: new Uint8Array([1]),
    });

    await readGitHubFolder(LOCATION, { fetch: stub.fetch });

    expect(
      stub.urls.every(
        (url) => url.startsWith("https://api.github.com/") || url.startsWith("https://raw.githubusercontent.com/"),
      ),
    ).toBe(true);
    expect(new Set(stub.userAgents)).toEqual(new Set(["skill-registry"]));
    // A fixed host that follows a redirect is not a fixed host.
    expect(new Set(stub.redirects)).toEqual(new Set(["manual" as RequestRedirect]));
  });

  it("refuses a download_url that points off raw.githubusercontent.com", async () => {
    const stub = stubGitHub({
      [CONTENTS]: [
        // GitHub would never send this. The check exists because it is the one
        // URL the walk does not build itself (ADR-0020).
        { path: "code-review/SKILL.md", type: "file", size: 12, download_url: "https://evil.example.com/payload" },
      ],
    });

    await expectReason(readGitHubFolder(LOCATION, { fetch: stub.fetch }), "untrusted_download_host");
    expect(stub.urls).not.toContain("https://evil.example.com/payload");
  });

  it("drops symlinks and submodules, as the publishing pipeline already does", async () => {
    const stub = stubGitHub({
      [CONTENTS]: [
        { path: "code-review/link", type: "symlink", download_url: null },
        { path: "code-review/vendor", type: "submodule", download_url: null },
      ],
    });

    await expectReason(readGitHubFolder(LOCATION, { fetch: stub.fetch }), "empty_folder");
  });

  it("resolves the default branch when the location names no ref", async () => {
    const stub = stubGitHub({
      "https://api.github.com/repos/acme/skills": { default_branch: "trunk" },
      "https://api.github.com/repos/acme/skills/contents/code-review?ref=trunk": [],
    });

    await expectReason(readGitHubFolder({ ...LOCATION, ref: null }, { fetch: stub.fetch }), "empty_folder");
    expect(stub.urls).toContain("https://api.github.com/repos/acme/skills/contents/code-review?ref=trunk");
  });

  describe("the ceilings a Skill is held to", () => {
    it("refuses more files than a Skill may contain, before fetching the one that breaks it", async () => {
      const stub = stubGitHub({
        [CONTENTS]: [file("code-review/a.md"), file("code-review/b.md")],
        [`${RAW}/a.md`]: new Uint8Array([1]),
        [`${RAW}/b.md`]: new Uint8Array([1]),
      });

      await expectReason(readGitHubFolder(LOCATION, { fetch: stub.fetch, maxFiles: 1 }), "too_many_entries");
      // Counted before fetching: the second file's bytes were never requested.
      expect(stub.urls).not.toContain(`${RAW}/b.md`);
    });

    it("refuses a folder larger than a Skill may be", async () => {
      const stub = stubGitHub({
        [CONTENTS]: [file("code-review/big.md", 5_000)],
        [`${RAW}/big.md`]: new Uint8Array([1]),
      });

      await expectReason(readGitHubFolder(LOCATION, { fetch: stub.fetch, maxBytes: 1_000 }), "uncompressed_too_large");
      expect(stub.urls).not.toContain(`${RAW}/big.md`);
    });

    it("applies the Artifact's own limits when the caller names none", async () => {
      // The defaults are the point: neither caller passes these, so a ceiling
      // cannot be dropped by omission. 1001 entries is one past
      // ARTIFACT_MAX_ENTRIES.
      const entries = Array.from({ length: 1_001 }, (_, index) => file(`code-review/${index}.md`, 0));
      const stub = stubGitHub({
        [CONTENTS]: entries,
        ...Object.fromEntries(entries.map((entry) => [`${RAW}/${(entry.path as string).split("/")[1]}`, new Uint8Array([1])])),
      });

      await expectReason(readGitHubFolder(LOCATION, { fetch: stub.fetch }), "too_many_entries");
    });
  });

  describe("what GitHub's refusals mean", () => {
    it("reads a 404 as not found", async () => {
      await expectReason(readGitHubFolder(LOCATION, { fetch: stubGitHub({}).fetch }), "not_found");
    });

    it("tells a rate limit apart from a refusal, though both are 403", async () => {
      const limited = stubGitHub({
        [CONTENTS]: new Response("rate limited", { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
      });
      await expectReason(readGitHubFolder(LOCATION, { fetch: limited.fetch }), "rate_limited");

      // A token is 5,000 requests an hour, not unlimited, so this is reachable
      // on the authenticated path too — where "sign in again" fixes nothing.
      const limitedWithToken = stubGitHub({
        [CONTENTS]: new Response("rate limited", { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
      });
      await expectReason(
        readGitHubFolder(LOCATION, { fetch: limitedWithToken.fetch, token: "gho_writer_token" }),
        "rate_limited",
      );
    });

    it("reads a 401 or a non-rate-limited 403 as unauthorized", async () => {
      const unauthorized = stubGitHub({ [CONTENTS]: new Response("nope", { status: 401 }) });
      await expectReason(readGitHubFolder(LOCATION, { fetch: unauthorized.fetch }), "unauthorized");

      const forbidden = stubGitHub({
        [CONTENTS]: new Response("nope", { status: 403, headers: { "x-ratelimit-remaining": "57" } }),
      });
      await expectReason(readGitHubFolder(LOCATION, { fetch: forbidden.fetch }), "unauthorized");
    });

    it("reads anything else, including an opaque redirect, as a failed request", async () => {
      const failed = stubGitHub({ [CONTENTS]: new Response("boom", { status: 500 }) });
      await expectReason(readGitHubFolder(LOCATION, { fetch: failed.fetch }), "request_failed");

      // What `redirect: "manual"` yields in a browser: status 0, not ok. The
      // refusal is the intent — a fixed host that follows a redirect is not one.
      const opaque = stubGitHub({ [CONTENTS]: Response.error() });
      await expectReason(readGitHubFolder(LOCATION, { fetch: opaque.fetch }), "request_failed");
    });
  });
});
