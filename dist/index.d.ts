import type { Plugin } from "@opencode-ai/plugin";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
type GoalsCombinedPlugin = Plugin & {
    id: "@op1/goals";
    tui: (api: TuiPluginApi) => Promise<void>;
};
export declare const GoalsPlugin: GoalsCombinedPlugin;
export default GoalsPlugin;
export { parseGoalCommand, parseTokenBudget } from "./command.js";
export { GoalsServerPlugin } from "./server.js";
export { installGoalsPlugin } from "./tui.js";
export type { GoalState, GoalStatus } from "./types.js";
