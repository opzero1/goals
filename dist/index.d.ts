import serverModule from "./server.entry.js";
export declare const id = "@op1/goals";
export declare const server: import("@opencode-ai/plugin").Plugin;
export declare const tui: (api: import("@opencode-ai/plugin/tui").TuiPluginApi) => Promise<void>;
/**
 * Programmatic entry. OpenCode itself loads the dedicated kind-specific
 * entries through `exports["./server"]` and `exports["./tui"]`; the default
 * export here keeps the package main loadable as a server plugin through the
 * `main` fallback used when `exports["./server"]` is missing.
 */
export default serverModule;
export { parseGoalCommand, parseTokenBudget } from "./command.js";
export { GoalsServerPlugin } from "./server.js";
export { installGoalsPlugin } from "./tui.js";
export type { GoalState, GoalStatus } from "./types.js";
