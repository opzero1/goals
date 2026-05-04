import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { GoalState, GoalStatus, StepUsage } from "./types.js";

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
	return (await file.json()) as GoalState;
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

export async function updateGoalStatus(root: string, sessionID: string, status: GoalStatus): Promise<GoalState | undefined> {
	const goal = await readGoal(root, sessionID);
	if (!goal) return undefined;
	return writeGoal(root, { ...goal, status, updatedAt: new Date().toISOString() });
}

export async function accountUsage(root: string, sessionID: string, usage: StepUsage): Promise<GoalState | undefined> {
	const goal = await readGoal(root, sessionID);
	if (!goal || goal.status !== "active") return goal;
	const tokensUsed = goal.tokensUsed + usage.input + usage.output;
	return writeGoal(root, {
		...goal,
		tokensUsed,
		status: goal.tokenBudget && tokensUsed >= goal.tokenBudget ? "budget_limited" : goal.status,
		updatedAt: new Date().toISOString(),
	});
}

export async function markTurnStarted(root: string, sessionID: string): Promise<void> {
	const goal = await readGoal(root, sessionID);
	if (!goal || goal.status !== "active") return;
	await writeGoal(root, { ...goal, lastTurnStartedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
}

export async function accountElapsed(root: string, sessionID: string): Promise<GoalState | undefined> {
	const goal = await readGoal(root, sessionID);
	if (!goal || !goal.lastTurnStartedAt) return goal;
	const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(goal.lastTurnStartedAt)) / 1000));
	return writeGoal(root, {
		...goal,
		timeUsedSeconds: goal.timeUsedSeconds + elapsed,
		lastTurnStartedAt: undefined,
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
