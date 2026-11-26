/**
 * Publishes the sample Skills, Plugins and MCP servers in this folder to a
 * running Registry, through the same API the CLI and web interface use, so
 * Artifacts land in object storage rather than only in the database.
 *
 * Usage: SKILLSET_URL=http://localhost:3000 SKILLSET_TOKEN=<writer token> bun scripts/seed/seed.ts
 *
 * Idempotent: publishing is an upsert by name, so a rerun replaces each entry.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
  buildPluginBundle,
  buildSkillBundle,
  McpPublishedSchema,
  PluginPublishedSchema,
  SkillPublishedSchema,
  type McpPublish,
  type SkillFile,
} from "../../packages/shared/src/index.ts";
import type { z } from "zod";

const SEED_DIR = import.meta.dir;
const baseUrl = requireEnv("SKILLSET_URL").replace(/\/+$/, "");
const token = requireEnv("SKILLSET_TOKEN");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}.`);
  return value;
}

async function walk(root: string, dir: string = root): Promise<SkillFile[]> {
  const files: SkillFile[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(root, path)));
    else files.push({ path: relative(root, path).split(sep).join("/"), bytes: new Uint8Array(await readFile(path)) });
  }
  return files;
}

async function subdirectories(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => join(dir, entry.name));
}

async function publish<T extends z.ZodType>(kind: string, name: string, body: unknown, schema: T): Promise<z.infer<T>> {
  const res = await fetch(`${baseUrl}/api/resources/${kind}/${name}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${kind} ${name}: ${res.status} ${await res.text()}`);
  return schema.parse(await res.json());
}

async function upload(
  targets: readonly { path: string; url: string; headers: Record<string, string> }[],
  files: readonly SkillFile[],
): Promise<void> {
  await Promise.all(
    targets.map(async (target, index) => {
      const file = files[index];
      if (file?.path !== target.path) throw new Error(`Upload target ${target.path} does not match ${file?.path}.`);
      const res = await fetch(target.url, { method: "PUT", headers: target.headers, body: file.bytes });
      if (!res.ok) throw new Error(`Uploading ${target.path}: ${res.status} ${await res.text()}`);
    }),
  );
}

for (const dir of await subdirectories(join(SEED_DIR, "skills"))) {
  const bundle = buildSkillBundle(await walk(dir));
  const published = await publish("skill", bundle.name, bundle.request, SkillPublishedSchema);
  await upload(published.upload.files, bundle.files);
  console.log(`skill   ${bundle.name}`);
}

for (const dir of await subdirectories(join(SEED_DIR, "plugins"))) {
  const bundle = buildPluginBundle(await walk(dir));
  const published = await publish("plugin", bundle.name, bundle.request, PluginPublishedSchema);
  await upload(published.upload.files, bundle.files);
  console.log(`plugin  ${bundle.name}`);
}

const mcps = JSON.parse(await readFile(join(SEED_DIR, "mcps.json"), "utf8")) as (McpPublish & { name: string })[];
for (const { name, ...body } of mcps) {
  await publish("mcp", name, body, McpPublishedSchema);
  console.log(`mcp     ${name}`);
}
