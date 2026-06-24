import serverModule from "./server.entry.js";
import tuiModule from "./tui.entry.js";

export const id = "@op1/goals";
export const server = serverModule.server;
export const tui = tuiModule.tui;

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
