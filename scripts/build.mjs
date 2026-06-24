import solid from "@opentui/solid/bun-plugin";

// Three independent bundles:
// - dist/server.js: server plugin entry, no @opentui/solid in its module
//   graph so the OpenCode server can load it without TUI dependencies.
// - dist/tui.js: TUI plugin entry, solid JSX compiled at build time; the TUI
//   host rewrites the external solid imports to its own runtime modules.
// - dist/goals.js: programmatic package main re-exporting both halves.
const builds = [
	{ entry: "src/server.entry.ts", out: "dist/server.js", solid: false },
	{ entry: "src/tui.entry.ts", out: "dist/tui.js", solid: true },
	{ entry: "src/index.tsx", out: "dist/goals.js", solid: true },
];

await Bun.$`mkdir -p dist`;

for (const item of builds) {
	const result = await Bun.build({
		entrypoints: [item.entry],
		target: "bun",
		format: "esm",
		external: ["@opencode-ai/plugin", "@opencode-ai/plugin/tui", "@opentui/solid", "solid-js", "zod"],
		plugins: item.solid ? [solid] : [],
	});

	if (!result.success) {
		for (const log of result.logs) console.error(log);
		process.exit(1);
	}

	const output = result.outputs[0];
	if (!output) {
		console.error(`Bun build produced no output for ${item.entry}.`);
		process.exit(1);
	}

	await Bun.write(item.out, output);
}
