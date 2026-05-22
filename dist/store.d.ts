import type { GoalState, GoalStatus, StepUsage } from "./types.js";
export declare function goalDirectory(root: string): string;
export declare function goalPath(root: string, sessionID: string): string;
export declare function readGoal(root: string, sessionID: string): Promise<GoalState | undefined>;
export declare function writeGoal(root: string, goal: GoalState): Promise<GoalState>;
export declare function deleteGoal(root: string, sessionID: string): Promise<boolean>;
export declare function createGoal(root: string, input: {
    sessionID: string;
    objective: string;
    tokenBudget?: number;
}): Promise<GoalState>;
export declare function replaceGoal(root: string, input: {
    sessionID: string;
    objective: string;
    tokenBudget?: number;
}): Promise<GoalState>;
export declare function updateGoalObjective(root: string, input: {
    sessionID: string;
    objective: string;
    status?: GoalStatus;
    tokenBudget?: number;
}): Promise<GoalState | undefined>;
export declare function updateGoalStatus(root: string, sessionID: string, status: GoalStatus): Promise<GoalState | undefined>;
export declare function accountUsage(root: string, sessionID: string, usage: StepUsage, expectedGoalID?: string): Promise<GoalState | undefined>;
export declare function markTurnStarted(root: string, sessionID: string): Promise<GoalState | undefined>;
export declare function accountElapsed(root: string, sessionID: string): Promise<GoalState | undefined>;
export declare function recordContinuation(root: string, sessionID: string): Promise<GoalState | undefined>;
export declare function markBudgetWrapPrompted(root: string, sessionID: string): Promise<GoalState | undefined>;
