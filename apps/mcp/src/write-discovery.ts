import { writeFile } from "node:fs/promises";
import { buildDiscoveryDocument, DISCOVERY_PATH, formatDiscoveryDocument } from "./discovery.js";

// Regenerates `docs/mcp.json`, which the Registry serves at `GET /mcp`.
// Run after changing any tool: `bun run --filter @in-org-quicko/skillset-mcp discovery`.
await writeFile(DISCOVERY_PATH, formatDiscoveryDocument(await buildDiscoveryDocument()), "utf8");
