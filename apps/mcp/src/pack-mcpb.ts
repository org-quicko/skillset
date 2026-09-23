import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { packExtension, v0_3 } from "@anthropic-ai/mcpb";
import pkg from "../package.json" with { type: "json" };
import { buildDiscoveryDocument } from "./discovery.js";
import { buildMcpbManifest } from "./mcpb.js";

// Packs `skillset-mcp.mcpb` from a staging directory holding only what the
// bundle needs, with a manifest generated from the server itself (ADR-0037).
// Run through `bun run package:mcpb`, which builds `dist/cli.js` first.

const root = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const stage = root("dist/bundle");

const manifest = buildMcpbManifest(await buildDiscoveryDocument());
const parsed = v0_3.McpbManifestSchema.safeParse(manifest);
if (!parsed.success) {
  console.error("The generated manifest is not a valid MCPB manifest:", parsed.error.issues);
  process.exit(1);
}

await rm(stage, { recursive: true, force: true });
await mkdir(`${stage}/dist`, { recursive: true });
await writeFile(`${stage}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
// `dist/cli.js` is ESM, which Node only runs as such beside a `package.json`
// that says so. Nothing else from the real one is needed: every dependency is
// already inlined by `src/build.ts`.
await writeFile(`${stage}/package.json`, `${JSON.stringify({ name: pkg.name, version: pkg.version, type: "module" }, null, 2)}\n`);
await copyFile(root("dist/cli.js"), `${stage}/dist/cli.js`);
await copyFile(root("LICENSE"), `${stage}/LICENSE`);
await copyFile(root("README.md"), `${stage}/README.md`);

if (!(await packExtension({ extensionPath: stage, outputPath: root("skillset-mcp.mcpb"), silent: true }))) {
  console.error("Packing the .mcpb failed.");
  process.exit(1);
}
