import type { TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { installGoalsPlugin } from "../src/tui.js";

/**
 * Development TUI entry, loaded straight from TypeScript source by the
 * repo-local tui.json. The OpenCode TUI host registers the solid transform
 * (ensureRuntimePluginSupport) before importing TUI plugins, so this .tsx
 * file and the .tsx files it imports compile correctly at load time and
 * share the host's solid runtime.
 */
const module = {
	id: "@op1/goals-dev",
	async tui(api: TuiPluginApi) {
		await installGoalsPlugin(api);
	},
} satisfies TuiPluginModule;

export default module;
