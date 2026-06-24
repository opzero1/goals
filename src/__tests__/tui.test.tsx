import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { describe, expect, test } from "bun:test";
import { createGoal, readGoal } from "../store.js";
import { installGoalsPlugin } from "../tui.js";

type RegisteredCommand = {
	name: string;
	slashName?: string;
	slashAliases?: string[];
	run: () => unknown;
};

async function tempRoot() {
	return mkdtemp(join(tmpdir(), "opencode-goals-tui-"));
}

function harness(root: string, sessionID = "s1") {
	const layers: Array<{ commands?: RegisteredCommand[] }> = [];
	const toasts: Array<{ message: string; variant?: string }> = [];
	const api = {
		route: { current: { name: "session", params: { sessionID } } },
		state: {
			path: { directory: root },
			session: { status: () => ({ type: "idle" }) },
		},
		keymap: {
			registerLayer(layer: { commands?: RegisteredCommand[] }) {
				layers.push(layer);
				return () => undefined;
			},
		},
		ui: {
			toast(input: { message: string; variant?: string }) {
				toasts.push(input);
			},
			dialog: { replace: () => undefined, clear: () => undefined },
			Dialog: () => null,
			DialogAlert: () => null,
			DialogConfirm: () => null,
			DialogPrompt: () => null,
			DialogSelect: () => null,
			Slot: () => null,
			Prompt: () => null,
		},
		slots: { register: () => () => undefined },
		event: { on: () => () => undefined },
		client: { session: { promptAsync: async () => ({}) } },
	} as unknown as TuiPluginApi;

	return { api, layers, toasts };
}

describe("goals TUI plugin", () => {
	test("registers direct slash commands for goal control actions", async () => {
		const root = await tempRoot();
		const h = harness(root);

		await installGoalsPlugin(h.api);
		const commands = h.layers.flatMap((layer) => layer.commands ?? []);

		expect(commands.find((command) => command.name === "goal.clear")?.slashName).toBe("goal-clear");
		expect(commands.find((command) => command.name === "goal.clear")?.slashAliases).toContain("goal clear");
		expect(commands.find((command) => command.name === "goal.pause")?.slashName).toBe("goal-pause");
		expect(commands.find((command) => command.name === "goal.resume")?.slashName).toBe("goal-resume");
		expect(commands.find((command) => command.name === "goal.edit")?.slashName).toBe("goal-edit");
	});

	test("direct clear command removes the current session goal", async () => {
		const root = await tempRoot();
		await createGoal(root, { sessionID: "s1", objective: "ship goals" });
		const h = harness(root);

		await installGoalsPlugin(h.api);
		const clear = h.layers.flatMap((layer) => layer.commands ?? []).find((command) => command.name === "goal.clear");
		expect(clear).toBeDefined();

		await clear?.run();

		expect(await readGoal(root, "s1")).toBeUndefined();
		expect(h.toasts.at(-1)?.message).toBe("Goal cleared");
	});
});
