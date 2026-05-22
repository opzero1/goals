import solid from "@opentui/solid/bun-plugin";

const result = await Bun.build({
	entrypoints: ["src/index.tsx"],
	target: "bun",
	format: "esm",
	external: ["@opencode-ai/plugin", "@opencode-ai/plugin/tui", "@opentui/solid", "solid-js", "zod"],
	plugins: [solid],
});

if (!result.success) {
	for (const log of result.logs) console.error(log);
	process.exit(1);
}

const output = result.outputs[0];
if (!output) {
	console.error("Bun build did not produce an output file.");
	process.exit(1);
}

await Bun.$`mkdir -p dist`;
await Bun.write("dist/goals.js", output);
