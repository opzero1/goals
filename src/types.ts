export type GoalStatus = "active" | "paused" | "budget_limited" | "complete";

export interface GoalState {
	sessionID: string;
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
}

export interface GoalOptions {
	maxContinuations: number;
	idleDelayMs: number;
}

export const DEFAULT_GOAL_OPTIONS: GoalOptions = {
	maxContinuations: 10,
	idleDelayMs: 3000,
};

export interface ParsedGoalCommand {
	action: "show" | "set" | "pause" | "resume" | "clear";
	objective?: string;
	tokenBudget?: number;
}

export interface StepUsage {
	input: number;
	output: number;
}
