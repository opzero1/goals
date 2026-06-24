import type { GoalState } from "./types.js";
export declare function buildGoalSystemPrompt(goal: GoalState): string;
export declare function buildContinuationPrompt(goal: GoalState): string;
export declare function buildBudgetLimitPrompt(goal: GoalState): string;
export declare function buildObjectiveUpdatedPrompt(goal: GoalState): string;
export declare function goalToolResponse(goal: GoalState | undefined, includeCompletionBudgetReport?: boolean): string;
export declare const GOAL_USAGE = "Usage: /goal [<objective>] or /goal-edit|/goal-pause|/goal-resume|/goal-clear";
export declare function formatGoalSummary(goal: GoalState): string;
export declare function formatGoalStatus(goal: GoalState): string;
