import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { buildSkillBundle, isExcludedPath, SkillPublishedSchema, type SkillFile } from "@skill-registry/shared";
import { rethrowValidationError } from "../errors.js";
import { ApiError, registryFetch, uploadArtifact } from "../http.js";
import { openAuthenticatedClient, type SessionDeps } from "../session.js";

export interface PublishDeps extends SessionDeps {
  cwd: string;
}

export interface PublishOptions {
  /** Defaults to `deps.cwd` — "the directory I am working in" (story 15). */
  path?: string;
}

export interface PublishResult {
  name: string;
  id: string;
  published_at: string;
}

/**
 * Reads every file under `root`, skipping whatever `isExcludedPath` (shared)
 * would exclude anyway — pruning descent into `node_modules`/`.git`/etc.
 * rather than reading them and discarding the bytes.
 */
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
 * Publishes the single Skill rooted at a directory holding a `SKILL.md`.
 *
 * @param deps - The fetch implementation, config-file path, environment, and the directory
 * a relative `options.path` is resolved against.
 * @param options - Where the Skill lives; defaults to `deps.cwd`.
 * @returns The published Skill's name, id, and publish timestamp.
 * @throws Error naming the rule when the Skill fails the local check — thrown before the
 * Registry is contacted at all.
 * @throws Error explaining how to authenticate when no Registry and Token are configured.
 * @throws Error about permissions when the Registry answers 403, so a reader's Token is
 * refused with a reason rather than a generic failure; and about the Token itself on 401.
 * @throws ApiError for any other refusal, and `RegistryUnreachableError` when neither the
 * Registry nor storage can be reached.
 *
 * @remarks
 * The Skill is validated locally with the same shared rules the API applies, then the row
 * is created and the Artifact uploaded straight to storage (ADR-0001).
 *
 * @example
 * ```ts
 * const { name, id } = await runPublish(deps, { path: "./skills/code-review" });
 * ```
 */
export async function runPublish(deps: PublishDeps, options: PublishOptions): Promise<PublishResult> {
  const targetPath = options.path ? resolve(deps.cwd, options.path) : deps.cwd;

  let bundle;
  try {
    bundle = buildSkillBundle(await walkSkillDirectory(targetPath));
  } catch (error) {
    rethrowValidationError(error);
  }

  const client = await openAuthenticatedClient(deps);

  let published;
  try {
    published = await registryFetch(client, `/resources/skill/${encodeURIComponent(bundle.name)}`, SkillPublishedSchema, {
      method: "PUT",
      body: JSON.stringify(bundle.request),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      throw new Error("This Token is not allowed to publish — publishing needs the writer role or higher.");
    }
    if (error instanceof ApiError && error.status === 401) {
      throw new Error("Token rejected — mint a new one from the web interface.");
    }
    throw error;
  }

  await uploadArtifact(deps.fetch, published.upload, bundle.artifact);

  return { name: published.skill.name, id: published.skill.id, published_at: published.skill.published_at };
}
