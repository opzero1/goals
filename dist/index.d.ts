import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
export declare const id = "@op1/goals";
export declare const server: import("@opencode-ai/plugin").Plugin;
export declare function tui(api: TuiPluginApi): Promise<void>;
export default server;
export { parseGoalCommand, parseTokenBudget } from "./command.js";
export { GoalsServerPlugin } from "./server.js";
export { installGoalsPlugin } from "./tui.js";
export type { GoalState, GoalStatus } from "./types.js";
