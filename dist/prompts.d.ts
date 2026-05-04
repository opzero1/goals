import type { GoalState } from "./types.js";
export declare function buildGoalSystemPrompt(goal: GoalState): string;
export declare function buildContinuationPrompt(goal: GoalState): string;
export declare function buildBudgetLimitPrompt(goal: GoalState): string;
export declare function formatGoalSummary(goal: GoalState): string;
export declare function formatGoalStatus(goal: GoalState): string;
