import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { GoalState, GoalStatus, StepUsage } from "./types.js";

const GOAL_STATUSES = new Set<GoalStatus>(["active", "paused", "budget_limited", "complete"]);

function isGoalStatus(value: unknown): value is GoalStatus {
	return typeof value === "string" && GOAL_STATUSES.has(value as GoalStatus);
}

function normalizeStatus(value: unknown): GoalStatus {
	if (isGoalStatus(value)) return value;
	if (value === "blocked" || value === "usage_limited") return "paused";
	return "active";
}

function normalizeGoal(raw: unknown): GoalState {
	const value = raw && typeof raw === "object" ? (raw as Partial<GoalState> & Record<string, unknown>) : {};
	const now = new Date().toISOString();
	return {
		sessionID: typeof value.sessionID === "string" ? value.sessionID : "",
		goalID: typeof value.goalID === "string" ? value.goalID : typeof value.goalId === "string" ? value.goalId : randomUUID(),
		objective: typeof value.objective === "string" ? value.objective : "",
		status: normalizeStatus(value.status),
		tokenBudget: typeof value.tokenBudget === "number" && Number.isFinite(value.tokenBudget) ? value.tokenBudget : undefined,
		tokensUsed: typeof value.tokensUsed === "number" && Number.isFinite(value.tokensUsed) ? value.tokensUsed : 0,
		timeUsedSeconds: typeof value.timeUsedSeconds === "number" && Number.isFinite(value.timeUsedSeconds) ? value.timeUsedSeconds : 0,
		continuationsUsed: typeof value.continuationsUsed === "number" && Number.isFinite(value.continuationsUsed) ? value.continuationsUsed : 0,
		budgetWrapPrompted: value.budgetWrapPrompted === true,
		createdAt: typeof value.createdAt === "string" ? value.createdAt : now,
		updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : now,
		lastTurnStartedAt: typeof value.lastTurnStartedAt === "string" ? value.lastTurnStartedAt : undefined,
		lastTurnGoalID: typeof value.lastTurnGoalID === "string" ? value.lastTurnGoalID : undefined,
	};
}

function safeSessionID(sessionID: string): string {
	return sessionID.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function goalDirectory(root: string): string {
	return join(root, ".opencode", "goals");
}

export function goalPath(root: string, sessionID: string): string {
	return join(goalDirectory(root), `${safeSessionID(sessionID)}.json`);
}

export async function readGoal(root: string, sessionID: string): Promise<GoalState | undefined> {
	const file = Bun.file(goalPath(root, sessionID));
	if (!(await file.exists())) return undefined;
	return normalizeGoal(await file.json());
}

export async function writeGoal(root: string, goal: GoalState): Promise<GoalState> {
	await mkdir(goalDirectory(root), { recursive: true });
	await Bun.write(goalPath(root, goal.sessionID), `${JSON.stringify(goal, null, 2)}\n`);
	return goal;
}

export async function deleteGoal(root: string, sessionID: string): Promise<boolean> {
	const path = goalPath(root, sessionID);
	if (!(await Bun.file(path).exists())) return false;
	await Bun.file(path).delete();
	return true;
}

export async function createGoal(root: string, input: { sessionID: string; objective: string; tokenBudget?: number }): Promise<GoalState> {
	const now = new Date().toISOString();
	return writeGoal(root, {
		sessionID: input.sessionID,
		goalID: randomUUID(),
		objective: input.objective.trim(),
		status: "active",
		tokenBudget: input.tokenBudget,
		tokensUsed: 0,
		timeUsedSeconds: 0,
		continuationsUsed: 0,
		budgetWrapPrompted: false,
		createdAt: now,
		updatedAt: now,
	});
}

export async function replaceGoal(root: string, input: { sessionID: string; objective: string; tokenBudget?: number }): Promise<GoalState> {
	return createGoal(root, input);
}

export async function updateGoalObjective(root: string, input: { sessionID: string; objective: string; status?: GoalStatus; tokenBudget?: number }): Promise<GoalState | undefined> {
	const goal = await readGoal(root, input.sessionID);
	if (!goal) return undefined;
	return writeGoal(root, {
		...goal,
		objective: input.objective.trim(),
		status: input.status ?? goal.status,
		tokenBudget: input.tokenBudget,
		updatedAt: new Date().toISOString(),
	});
}

export async function updateGoalStatus(root: string, sessionID: string, status: GoalStatus): Promise<GoalState | undefined> {
	const goal = await readGoal(root, sessionID);
	if (!goal) return undefined;
	const resumingPausedGoal = goal.status === "paused" && status === "active";
	return writeGoal(root, {
		...goal,
		status,
		continuationsUsed: resumingPausedGoal ? 0 : goal.continuationsUsed,
		budgetWrapPrompted: status === "active" ? false : goal.budgetWrapPrompted,
		lastTurnStartedAt: status === "active" ? goal.lastTurnStartedAt : undefined,
		lastTurnGoalID: status === "active" ? goal.lastTurnGoalID : undefined,
		updatedAt: new Date().toISOString(),
	});
}

export async function accountUsage(root: string, sessionID: string, usage: StepUsage, expectedGoalID?: string): Promise<GoalState | undefined> {
	const goal = await readGoal(root, sessionID);
	if (!goal || goal.status !== "active") return goal;
	if (expectedGoalID && goal.goalID !== expectedGoalID) return goal;
	if (goal.lastTurnGoalID && goal.lastTurnGoalID !== goal.goalID) return goal;
	const tokenDelta = usage.input + usage.output;
	const tokensUsed = goal.tokensUsed + tokenDelta;
	return writeGoal(root, {
		...goal,
		tokensUsed,
		status: goal.tokenBudget && tokensUsed >= goal.tokenBudget ? "budget_limited" : goal.status,
		lastTurnGoalID: undefined,
		updatedAt: new Date().toISOString(),
	});
}

export async function markTurnStarted(root: string, sessionID: string): Promise<GoalState | undefined> {
	const goal = await readGoal(root, sessionID);
	if (!goal || goal.status !== "active") return goal;
	return writeGoal(root, { ...goal, lastTurnStartedAt: new Date().toISOString(), lastTurnGoalID: goal.goalID, updatedAt: new Date().toISOString() });
}

export async function accountElapsed(root: string, sessionID: string): Promise<GoalState | undefined> {
	const goal = await readGoal(root, sessionID);
	if (!goal || !goal.lastTurnStartedAt) return goal;
	const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(goal.lastTurnStartedAt)) / 1000));
	return writeGoal(root, {
		...goal,
		timeUsedSeconds: goal.timeUsedSeconds + elapsed,
		lastTurnStartedAt: undefined,
		lastTurnGoalID: undefined,
		updatedAt: new Date().toISOString(),
	});
}

export async function recordContinuation(root: string, sessionID: string): Promise<GoalState | undefined> {
	const goal = await readGoal(root, sessionID);
	if (!goal) return undefined;
	return writeGoal(root, { ...goal, continuationsUsed: goal.continuationsUsed + 1, updatedAt: new Date().toISOString() });
}

export async function markBudgetWrapPrompted(root: string, sessionID: string): Promise<GoalState | undefined> {
	const goal = await readGoal(root, sessionID);
	if (!goal) return undefined;
	return writeGoal(root, { ...goal, budgetWrapPrompted: true, updatedAt: new Date().toISOString() });
}
