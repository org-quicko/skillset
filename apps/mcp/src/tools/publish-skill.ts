import { realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
  apiErrorFrom,
  buildSkillBundle,
  formatSkillValidationError,
  SKILL_FILE_NAME,
  SkillPublishedSchema,
  SkillValidationError,
  type SkillBundle,
} from "@in-org-quicko/skillset-shared";
import { holdsSkillFile, readRepositorySkill, walkSkillDirectory } from "@in-org-quicko/skillset-installer";

export interface PublishSkillDeps {
  fetchImpl: typeof fetch;
  registry: string;
  /** The writer's Token — required; publishing needs the writer role or higher (ADR-0035). */
  token: string;
  /** Resolves a relative `path` against — the directory the server was started in. */
  cwd: string;
  /** The environment git runs under for a `url`, so the User's own credentials apply (ADR-0044). */
  env: NodeJS.ProcessEnv;
}

/** Where to publish from: a directory in this project, or one named Skill in a repository. */
export interface PublishSkillInput {
  /** A directory inside the project holding the Skill's own `SKILL.md`. */
  path?: string;
  /** A GitHub or GitLab URL — a repository, or a folder in one. */
  url?: string;
  /** Which Skill to publish out of `url`, by the name its `SKILL.md` declares. Required with `url`. */
  name?: string;
}

export interface PublishSkillResult {
  name: string;
  id: string;
  published_at: string;
  /** The repository it was published from, or `null` for a directory in this project. */
  source: string | null;
  /** Every file that left this machine, and what they came to — see `publishSkill`. */
  files: { path: string; size: number }[];
  total_bytes: number;
}

/**
 * Resolves `path` inside the project, refusing anything that escapes it.
 *
 * @remarks
 * `path` is chosen by the *model*, not by the person running the Agent, and
 * everything below the directory it names is uploaded to a Registry whose
 * reads are unauthenticated (ADR-0013). An absolute path, or one climbing out
 * with `../..`, was therefore a way to publish any readable directory on the
 * machine — `~/.ssh` and `~/.aws` included — and a prompt injection inside a
 * Skill the Agent had just installed is enough to ask for it (ISSUE-12).
 *
 * Checked after `realpath` on both sides, so a symlink pointing out of the
 * project is refused too: comparing the strings before resolving them would
 * be a check a link walks straight past. `realpath` on the project root also
 * settles the macOS `/tmp` → `/private/tmp` case, where the two spellings of
 * one directory would otherwise fail to match.
 *
 * @param cwd - The project root, from the MCP server's own working directory.
 * @param path - The requested directory, relative to `cwd` unless absolute.
 * @returns The resolved, contained directory.
 * @throws Error naming `path` if it resolves outside `cwd`, or if either
 * directory does not exist.
 * @example
 * ```ts
 * await containedPath("/work/project", "skills/code-review"); // "/work/project/skills/code-review"
 * await containedPath("/work/project", "../../etc"); // throws
 * ```
 */
async function containedPath(cwd: string, path: string | undefined): Promise<string> {
  const root = await realpath(cwd);
  if (path === undefined) return root;

  let target: string;
  try {
    target = await realpath(resolve(root, path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`No directory at "${path}".`);
    }
    throw error;
  }

  const inside = target === root || target.startsWith(root.endsWith(sep) ? root : root + sep);
  if (!inside) {
    throw new Error(
      `"${path}" is outside this project (${root}). publish_skill only publishes a directory inside it.`,
    );
  }
  return target;
}

/** Uploads one file of the Artifact straight to its presigned destination (ADR-0001, ADR-0032). */
async function uploadFile(
  fetchImpl: typeof fetch,
  target: { path: string; url: string; method: "PUT"; headers: Record<string, string> },
  bytes: Uint8Array,
): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl(target.url, { method: target.method, headers: target.headers, body: bytes });
  } catch (error) {
    throw new Error(`Could not reach storage to upload "${target.path}": ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!res.ok) {
    throw new Error(`Uploading "${target.path}" failed with status ${res.status}.`);
  }
}

/**
 * PUTs a Skill's metadata, then uploads its Artifact straight to storage (ADR-0001).
 *
 * @throws Error about the writer role when the Registry answers 403, and about the Token
 * itself on 401, so a rejected Token reads as a reason rather than a generic failure.
 * @throws ApiError for any other refusal from the Registry.
 */
async function publishBundle(deps: PublishSkillDeps, bundle: SkillBundle): Promise<PublishSkillResult> {
  let res: Response;
  try {
    res = await deps.fetchImpl(new URL(`/api/resources/skill/${encodeURIComponent(bundle.name)}`, deps.registry), {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${deps.token}` },
      body: JSON.stringify(bundle.request),
    });
  } catch (error) {
    throw new Error(`Could not reach ${deps.registry}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!res.ok) {
    const apiError = await apiErrorFrom(res);
    if (apiError.status === 403) {
      throw new Error("This Token is not allowed to publish — publishing needs the writer role or higher.");
    }
    if (apiError.status === 401) {
      throw new Error("Token rejected — configure a current one (--token or SKILLSET_TOKEN).");
    }
    throw apiError;
  }

  const published = SkillPublishedSchema.parse(await res.json());

  // One presigned destination per declared file, in the order the manifest declared them
  // (ADR-0032), so the two lists line up index for index.
  await Promise.all(
    published.upload.files.map((target, index) => {
      const file = bundle.files[index];
      if (!file || file.path !== target.path) {
        throw new Error("The Registry returned upload targets that do not match the files it was told about.");
      }
      return uploadFile(deps.fetchImpl, target, file.bytes);
    }),
  );

  return {
    name: published.skill.name,
    id: published.skill.id,
    published_at: published.skill.published_at,
    source: bundle.request.source ?? null,
    files: bundle.files.map((file) => ({ path: file.path, size: file.bytes.byteLength })),
    total_bytes: bundle.files.reduce((total, file) => total + file.bytes.byteLength, 0),
  };
}

/**
 * Publishes a Skill to the Registry — the one at a directory in this project,
 * or one named Skill out of a GitHub or GitLab repository.
 *
 * @param deps - The injected `fetch`, the Registry's URL, the writer's Token, the directory a
 * relative `path` is resolved against, and the environment git runs under for a `url`.
 * @param input - Either `path`, relative to `deps.cwd` and defaulting to it; or `url` with
 * `name`, the name the Skill's `SKILL.md` declares. `path` and `url` never combine.
 * @returns The published Skill's name, id, publish timestamp, the repository it came from
 * when there was one, and the list of files that were uploaded with their sizes — so
 * whoever is reading the Agent's output can see what left the machine rather than having
 * to trust that it was what they meant.
 * @throws Error when both `path` and `url` are given, `url` is given without `name`, or
 * `name` without `url`.
 * @throws Error naming `path` if it resolves outside `deps.cwd`, if no directory is there,
 * or if it holds no `SKILL.md` at its root — this tool publishes exactly one Skill.
 * @throws Error with git's own message when `url` cannot be cloned, or naming every Skill
 * found when none there declares `name`.
 * @throws Error naming the rule broken when the Skill fails the local validation rules
 * (`buildSkillBundle`) — thrown before the Registry is contacted at all.
 * @throws Error about the writer role when the Registry answers 403, and about the Token
 * itself on 401.
 * @throws ApiError for any other refusal from the Registry.
 *
 * @remarks
 * Republishing an already-published name overwrites it completely rather than versioning
 * (ADR-0002) — the same behaviour `skillset publish` has, available without a terminal.
 * Unlike `search_skills` and `install_skills`, this sends an `authorization` header:
 * publishing needs a writer Token, which is why it is the one tool this server is configured
 * with a Token for at all (ADR-0035).
 *
 * A `url` is cloned with the User's own git exactly as `skillset publish <url> --name` clones
 * it, and the repository is recorded as the Skill's Source and, through it, its Namespace
 * (ADR-0044). That reaches private repositories the User can clone, which is the point — and
 * why `name` is required, so the model has to say which Skill it means rather than having one
 * chosen for it. A `path` stays confined to the project (ISSUE-12).
 *
 * @example
 * ```ts
 * const deps = { fetchImpl: fetch, registry, token, cwd: process.cwd(), env: process.env };
 * await publishSkill(deps, { path: "./skills/code-review" });
 * await publishSkill(deps, { url: "https://github.com/acme/skills", name: "pdf" });
 * ```
 */
export async function publishSkill(deps: PublishSkillDeps, input: PublishSkillInput = {}): Promise<PublishSkillResult> {
  if (input.url && input.path !== undefined) {
    throw new Error("Pass either path or url, not both.");
  }
  if (input.url && !input.name) {
    throw new Error("Pass name with url to say which Skill to publish — the name in its SKILL.md.");
  }
  if (!input.url && input.name) {
    throw new Error("name picks a Skill out of a url; a path already says which Skill to publish.");
  }
  if (input.url && input.name) {
    const { bundle } = await readRepositorySkill(input.url, input.name, deps.env);
    return publishBundle(deps, bundle);
  }

  const targetPath = await containedPath(deps.cwd, input.path);

  if (!(await holdsSkillFile(targetPath))) {
    throw new Error(`No ${SKILL_FILE_NAME} found at "${targetPath}" — point path at the Skill's own directory.`);
  }

  let bundle: SkillBundle;
  try {
    bundle = buildSkillBundle(await walkSkillDirectory(targetPath));
  } catch (error) {
    if (error instanceof SkillValidationError) throw new Error(formatSkillValidationError(error));
    throw error;
  }

  return publishBundle(deps, bundle);
}
