import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
/**
 * TUI plugin entry. The OpenCode TUI resolves this module for the `tui`
 * plugin kind via the package.json `exports["./tui"]` subpath (or a tui.json
 * file spec) and expects a default export shaped `{ id?, tui }`
 * (TuiPluginModule). A module must not default-export both server() and
 * tui(), which is why the server and TUI entries are separate files.
 */
declare const module: {
    id: string;
    tui(api: TuiPluginApi): Promise<void>;
};
export default module;
