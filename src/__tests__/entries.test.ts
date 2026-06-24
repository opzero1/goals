import { describe, expect, test } from "bun:test";

/**
 * OpenCode's readV1Plugin contract: a plugin module must default-export an
 * object with either server() or tui() — never both — and the server/TUI
 * loaders resolve kind-specific entries via package.json exports subpaths.
 * These tests pin every entry module we ship or load in dev to that shape.
 */
async function loadDefault(path: string) {
	const mod = (await import(path)) as { default?: Record<string, unknown> };
	expect(mod.default).toBeDefined();
	return mod.default as Record<string, unknown>;
}

describe("plugin entry shapes", () => {
	test("server entry default-exports { id, server } without tui", async () => {
		const entry = await loadDefault("../server.entry.js");
		expect(typeof entry.id).toBe("string");
		expect(typeof entry.server).toBe("function");
		expect("tui" in entry).toBe(false);
	});

	test("tui entry default-exports { id, tui } without server", async () => {
		const entry = await loadDefault("../tui.entry.js");
		expect(typeof entry.id).toBe("string");
		expect(typeof entry.tui).toBe("function");
		expect("server" in entry).toBe(false);
	});

	test("dev server entry matches the server module shape", async () => {
		const entry = await loadDefault("../../dev/server.js");
		expect(typeof entry.id).toBe("string");
		expect(typeof entry.server).toBe("function");
		expect("tui" in entry).toBe(false);
	});

	test("dev tui entry matches the tui module shape", async () => {
		const entry = await loadDefault("../../dev/tui.js");
		expect(typeof entry.id).toBe("string");
		expect(typeof entry.tui).toBe("function");
		expect("server" in entry).toBe(false);
	});

	test("package main default-exports the server module for the main fallback", async () => {
		const entry = await loadDefault("../index.js");
		expect(typeof entry.server).toBe("function");
		expect("tui" in entry).toBe(false);
	});

	test("package exports declare kind-specific entries", async () => {
		const pkg = (await import("../../package.json")) as { default: { exports: Record<string, Record<string, string>> } };
		expect(pkg.default.exports["./server"]?.import).toBe("./dist/server.js");
		expect(pkg.default.exports["./tui"]?.import).toBe("./dist/tui.js");
	});
});
