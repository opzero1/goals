export type GoalStatus = "active" | "paused" | "budget_limited" | "complete";
export interface GoalState {
    sessionID: string;
    goalID: string;
    objective: string;
    status: GoalStatus;
    tokenBudget?: number;
    tokensUsed: number;
    timeUsedSeconds: number;
    continuationsUsed: number;
    budgetWrapPrompted: boolean;
    createdAt: string;
    updatedAt: string;
    lastTurnStartedAt?: string;
    lastTurnGoalID?: string;
}
export interface GoalOptions {
    maxContinuations: number;
    idleDelayMs: number;
}
export declare const DEFAULT_GOAL_OPTIONS: GoalOptions;
export interface ParsedGoalCommand {
    action: "show" | "set" | "edit" | "pause" | "resume" | "clear";
    objective?: string;
    tokenBudget?: number;
}
export interface StepUsage {
    input: number;
    output: number;
}
