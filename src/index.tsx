import type { Plugin } from "@opencode-ai/plugin";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { GoalsServerPlugin } from "./server.js";
import { installGoalsPlugin } from "./tui.js";

type GoalsCombinedPlugin = Plugin & {
	id: "@op1/goals";
	tui: (api: TuiPluginApi) => Promise<void>;
};

export const GoalsPlugin: GoalsCombinedPlugin = Object.assign(GoalsServerPlugin(), {
	id: "@op1/goals" as const,
	async tui(api: TuiPluginApi) {
		await installGoalsPlugin(api);
	},
});

export default GoalsPlugin;
export { parseGoalCommand, parseTokenBudget } from "./command.js";
export { GoalsServerPlugin } from "./server.js";
export { installGoalsPlugin } from "./tui.js";
export type { GoalState, GoalStatus } from "./types.js";
