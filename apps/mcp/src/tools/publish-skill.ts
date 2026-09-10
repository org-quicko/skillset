import { access, readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  apiErrorFrom,
  buildSkillBundle,
  formatSkillValidationError,
  isExcludedPath,
  SKILL_FILE_NAME,
  SkillPublishedSchema,
  SkillValidationError,
  type SkillBundle,
  type SkillFile,
} from "@skillset/shared";

export interface PublishSkillDeps {
  fetchImpl: typeof fetch;
  registry: string;
  /** The writer's Token — required; publishing needs the writer role or higher (ADR-0035). */
  token: string;
  /** Resolves a relative `path` against — the directory the server was started in. */
  cwd: string;
}

export interface PublishSkillResult {
  name: string;
  id: string;
  published_at: string;
}

/** Reads every file under `root`, skipping whatever `isExcludedPath` (shared) would exclude anyway. */
async function walkSkillDirectory(root: string, dir: string = root): Promise<SkillFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: SkillFile[] = [];

  for (const entry of entries) {
    const absolutePath = join(dir, entry.name);
    const relativePath = relative(root, absolutePath).split(sep).join("/");
    if (isExcludedPath(relativePath)) continue;

    if (entry.isDirectory()) {
      files.push(...(await walkSkillDirectory(root, absolutePath)));
    } else if (entry.isFile()) {
      files.push({ path: relativePath, bytes: await readFile(absolutePath) });
    }
  }

  return files;
}

/**
 * Whether `dir` itself holds a `SKILL.md` — the mark of a Skill's own root.
 *
 * @remarks
 * Only a missing file reads as `false`. Anything else `access` throws — a permission error, a
 * broken symlink — is a real problem with `dir` and is rethrown rather than silently reading as
 * "not a Skill".
 */
async function holdsSkillFile(dir: string): Promise<boolean> {
  try {
    await access(join(dir, SKILL_FILE_NAME));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
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

  return { name: published.skill.name, id: published.skill.id, published_at: published.skill.published_at };
}

/**
 * Publishes the Skill at a directory to the Registry.
 *
 * @param deps - The injected `fetch`, the Registry's URL, the writer's Token, and the
 * directory a relative `path` is resolved against.
 * @param path - Where the Skill lives, relative to `deps.cwd`; defaults to `deps.cwd` itself.
 * @returns The published Skill's name, id, and publish timestamp.
 * @throws Error naming the directory when it holds no `SKILL.md` at its root — this tool
 * publishes exactly the Skill at `path`, not a discovery walk over several.
 * @throws Error naming the rule broken when the Skill fails the local validation rules
 * (`buildSkillBundle`) — thrown before the Registry is contacted at all.
 * @throws Error about the writer role when the Registry answers 403, and about the Token
 * itself on 401.
 * @throws ApiError for any other refusal from the Registry.
 *
 * @remarks
 * Republishing an already-published name overwrites it completely rather than versioning
 * (ADR-0002) — the same behaviour `skillset publish` has always had, now available without a
 * terminal. Unlike `search_skills` and `add_skills`, this sends an `authorization` header:
 * publishing needs a writer Token, which is why it is the one tool this server is configured
 * with a Token for at all (ADR-0035).
 *
 * @example
 * ```ts
 * const { name, id } = await publishSkill(
 *   { fetchImpl: fetch, registry: "https://registry.example", token, cwd: process.cwd() },
 *   "./skills/code-review",
 * );
 * ```
 */
export async function publishSkill(deps: PublishSkillDeps, path?: string): Promise<PublishSkillResult> {
  const targetPath = path ? resolve(deps.cwd, path) : deps.cwd;

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
