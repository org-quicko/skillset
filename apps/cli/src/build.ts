/**
 * Bundles the CLI entry point into `dist/cli.js`.
 *
 * Runtime dependencies (from `package.json`) are marked external rather than
 * bundled, since they're installed alongside the CLI package when consumers
 * `npm install` it — keeping the output small and derived automatically so
 * it can't drift from `package.json`.
 */
import pkg from "../package.json" with { type: "json" };

const result = await Bun.build({
	entrypoints: ["./src/cli.ts"],
	outdir: "dist",
	target: "node",
	format: "esm",
	external: Object.keys(pkg.dependencies),
});

if (!result.success) {
	for (const message of result.logs) {
		console.error(message);
	}
	process.exit(1);
}
