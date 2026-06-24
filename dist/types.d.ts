export type GoalStatus = "active" | "paused" | "blocked" | "usage_limited" | "budget_limited" | "complete";
/** Why the system stopped an active goal after a turn failure (codex on_turn_error parity). */
export type GoalStopReason = "usage_limit" | "turn_error";
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
    /** Non-cached input tokens. OpenCode step events already exclude cache reads/writes. */
    input: number;
    /** Output tokens excluding reasoning (OpenCode reports reasoning separately). */
    output: number;
    /** Reasoning tokens. Codex counts these inside output, so accounting adds them back. */
    reasoning: number;
}
