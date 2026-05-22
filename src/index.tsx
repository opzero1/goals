import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { GoalsServerPlugin } from "./server.js";
import { installGoalsPlugin } from "./tui.js";

export const id = "@op1/goals";
export const server = GoalsServerPlugin();
export async function tui(api: TuiPluginApi) {
	await installGoalsPlugin(api);
}

export default server;
export { parseGoalCommand, parseTokenBudget } from "./command.js";
export { GoalsServerPlugin } from "./server.js";
export { installGoalsPlugin } from "./tui.js";
export type { GoalState, GoalStatus } from "./types.js";
