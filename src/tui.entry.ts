import type { TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { installGoalsPlugin } from "./tui.js";

/**
 * TUI plugin entry. The OpenCode TUI resolves this module for the `tui`
 * plugin kind via the package.json `exports["./tui"]` subpath (or a tui.json
 * file spec) and expects a default export shaped `{ id?, tui }`
 * (TuiPluginModule). A module must not default-export both server() and
 * tui(), which is why the server and TUI entries are separate files.
 */
const module = {
	id: "@op1/goals",
	async tui(api: TuiPluginApi) {
		await installGoalsPlugin(api);
	},
} satisfies TuiPluginModule;

export default module;
