import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { buildSkillBundle, isExcludedPath, SkillPublishedSchema, SkillValidationError, type SkillFile } from "@skill-registry/shared";
import { NOT_LOGGED_IN_MESSAGE, readConfig, resolveCredentials } from "../config.js";
import { registryFetch, uploadArtifact, type RegistryClient } from "../http.js";

export interface PublishDeps {
  fetch: typeof fetch;
  configPath: string;
  env: NodeJS.ProcessEnv;
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
 * Publishes the single Skill rooted at `options.path` (or `deps.cwd`):
 * validates it locally with the same rules the API applies (no network call
 * on failure), then creates the row and uploads the Artifact directly to
 * storage (ADR-0001).
 */
export async function runPublish(deps: PublishDeps, options: PublishOptions): Promise<PublishResult> {
  const targetPath = options.path ? resolve(deps.cwd, options.path) : deps.cwd;

  let bundle;
  try {
    bundle = buildSkillBundle(await walkSkillDirectory(targetPath));
  } catch (error) {
    if (error instanceof SkillValidationError) {
      throw new Error(`${error.rule}: ${error.message}${error.field ? ` (${error.field})` : ""}`);
    }
    throw error;
  }

  const fileConfig = await readConfig(deps.configPath);
  const credentials = resolveCredentials(deps.env, fileConfig);
  if (!credentials) throw new Error(NOT_LOGGED_IN_MESSAGE);

  const client: RegistryClient = { fetch: deps.fetch, registry: credentials.registry, token: credentials.token };
  const published = await registryFetch(client, `/skills/${encodeURIComponent(bundle.name)}`, SkillPublishedSchema, {
    method: "PUT",
    body: JSON.stringify({
      description: bundle.description,
      body: bundle.body,
      license: bundle.license,
      compatibility: bundle.compatibility,
      metadata: bundle.metadata,
      allowed_tools: bundle.allowed_tools,
    }),
  });

  await uploadArtifact(deps.fetch, published.upload, bundle.artifact);

  return { name: published.skill.name, id: published.skill.id, published_at: published.skill.published_at };
}
