const result = await Bun.build({
	entrypoints: ["./src/cli.ts"],
	outdir: "dist",
	target: "node",
	format: "esm",
});

if (!result.success) {
	for (const message of result.logs) {
		console.error(message);
	}
	process.exit(1);
}

export {}