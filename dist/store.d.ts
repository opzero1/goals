import type { GoalState, GoalStatus, GoalStopReason, StepUsage } from "./types.js";
/** Statuses the user can resume from with `/goal-resume` (codex parity; budget_limited needs a budget extension). */
export declare const RESUMABLE_STATUSES: ReadonlySet<GoalStatus>;
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
/**
 * Codex `stop_active_goal_for_turn` parity: usage-limit turn errors stop active
 * or budget_limited goals as usage_limited; other terminal turn errors block
 * active goals so idle continuation cannot loop on a failing turn.
 */
export declare function stopGoalForTurnError(root: string, sessionID: string, reason: GoalStopReason): Promise<GoalState | undefined>;
export declare function accountUsage(root: string, sessionID: string, usage: StepUsage, expectedGoalID?: string): Promise<GoalState | undefined>;
export declare function markTurnStarted(root: string, sessionID: string): Promise<GoalState | undefined>;
export declare function accountElapsed(root: string, sessionID: string): Promise<GoalState | undefined>;
export declare function recordContinuation(root: string, sessionID: string): Promise<GoalState | undefined>;
export declare function markBudgetWrapPrompted(root: string, sessionID: string): Promise<GoalState | undefined>;
