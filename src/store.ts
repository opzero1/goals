import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { GoalState, GoalStatus, GoalStopReason, StepUsage } from "./types.js";

const GOAL_STATUSES = new Set<GoalStatus>(["active", "paused", "blocked", "usage_limited", "budget_limited", "complete"]);

/** Statuses the user can resume from with `/goal-resume` (codex parity; budget_limited needs a budget extension). */
export const RESUMABLE_STATUSES: ReadonlySet<GoalStatus> = new Set(["paused", "blocked", "usage_limited"]);

function isGoalStatus(value: unknown): value is GoalStatus {
	return typeof value === "string" && GOAL_STATUSES.has(value as GoalStatus);
}

function normalizeStatus(value: unknown): GoalStatus {
	if (isGoalStatus(value)) return value;
	return "active";
}

function normalizeTokenBudget(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

// Serialize read-modify-write cycles per goal file so concurrent step/idle/tool
// events cannot drop accounting updates (codex #26155 parity).
const goalLocks = new Map<string, Promise<unknown>>();

async function withGoalLock<T>(root: string, sessionID: string, work: () => Promise<T>): Promise<T> {
	const key = `${root}\u0000${sessionID}`;
	const previous = goalLocks.get(key) ?? Promise.resolve();
	const run = previous.then(work, work);
	const settled = run.then(
		() => undefined,
		() => undefined,
	);
	goalLocks.set(key, settled);
	try {
		return await run;
	} finally {
		if (goalLocks.get(key) === settled) goalLocks.delete(key);
	}
}

/**
 * Codex `status_after_budget_limit` parity: an active goal that meets its token
 * budget becomes budget_limited, and a budget_limited goal whose budget was
 * raised above usage reverts to active.
 */
function statusAfterBudgetLimit(goal: GoalState): GoalStatus {
	if (goal.status === "active" && goal.tokenBudget !== undefined && goal.tokensUsed >= goal.tokenBudget) return "budget_limited";
	if (goal.status === "budget_limited" && (goal.tokenBudget === undefined || goal.tokensUsed < goal.tokenBudget)) return "active";
	return goal.status;
}

function normalizeGoal(raw: unknown): GoalState {
	const value = raw && typeof raw === "object" ? (raw as Partial<GoalState> & Record<string, unknown>) : {};
	const now = new Date().toISOString();
	const goal: GoalState = {
		sessionID: typeof value.sessionID === "string" ? value.sessionID : "",
		goalID: typeof value.goalID === "string" ? value.goalID : typeof value.goalId === "string" ? value.goalId : randomUUID(),
		objective: typeof value.objective === "string" ? value.objective : "",
		status: normalizeStatus(value.status),
		tokenBudget: normalizeTokenBudget(value.tokenBudget),
		tokensUsed: typeof value.tokensUsed === "number" && Number.isFinite(value.tokensUsed) ? value.tokensUsed : 0,
		timeUsedSeconds: typeof value.timeUsedSeconds === "number" && Number.isFinite(value.timeUsedSeconds) ? value.timeUsedSeconds : 0,
		continuationsUsed: typeof value.continuationsUsed === "number" && Number.isFinite(value.continuationsUsed) ? value.continuationsUsed : 0,
		budgetWrapPrompted: value.budgetWrapPrompted === true,
		createdAt: typeof value.createdAt === "string" ? value.createdAt : now,
		updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : now,
		lastTurnStartedAt: typeof value.lastTurnStartedAt === "string" ? value.lastTurnStartedAt : undefined,
		lastTurnGoalID: typeof value.lastTurnGoalID === "string" ? value.lastTurnGoalID : undefined,
	};
	return { ...goal, status: statusAfterBudgetLimit(goal) };
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
	return withGoalLock(root, sessionID, async () => {
		const path = goalPath(root, sessionID);
		if (!(await Bun.file(path).exists())) return false;
		await Bun.file(path).delete();
		return true;
	});
}

export async function createGoal(root: string, input: { sessionID: string; objective: string; tokenBudget?: number }): Promise<GoalState> {
	return withGoalLock(root, input.sessionID, async () => {
		const now = new Date().toISOString();
		return writeGoal(root, {
			sessionID: input.sessionID,
			goalID: randomUUID(),
			objective: input.objective.trim(),
			status: "active",
			tokenBudget: normalizeTokenBudget(input.tokenBudget),
			tokensUsed: 0,
			timeUsedSeconds: 0,
			continuationsUsed: 0,
			budgetWrapPrompted: false,
			createdAt: now,
			updatedAt: now,
		});
	});
}

export async function replaceGoal(root: string, input: { sessionID: string; objective: string; tokenBudget?: number }): Promise<GoalState> {
	return createGoal(root, input);
}

export async function updateGoalObjective(root: string, input: { sessionID: string; objective: string; status?: GoalStatus; tokenBudget?: number }): Promise<GoalState | undefined> {
	return withGoalLock(root, input.sessionID, async () => {
		const goal = await readGoal(root, input.sessionID);
		if (!goal) return undefined;
		const next: GoalState = {
			...goal,
			objective: input.objective.trim(),
			status: input.status ?? goal.status,
			tokenBudget: normalizeTokenBudget(input.tokenBudget),
			updatedAt: new Date().toISOString(),
		};
		return writeGoal(root, { ...next, status: statusAfterBudgetLimit(next) });
	});
}

export async function updateGoalStatus(root: string, sessionID: string, status: GoalStatus): Promise<GoalState | undefined> {
	return withGoalLock(root, sessionID, async () => {
		const goal = await readGoal(root, sessionID);
		if (!goal) return undefined;
		const resuming = RESUMABLE_STATUSES.has(goal.status) && status === "active";
		const next: GoalState = {
			...goal,
			status,
			continuationsUsed: resuming ? 0 : goal.continuationsUsed,
			budgetWrapPrompted: status === "active" ? false : goal.budgetWrapPrompted,
			lastTurnStartedAt: status === "active" ? goal.lastTurnStartedAt : undefined,
			lastTurnGoalID: status === "active" ? goal.lastTurnGoalID : undefined,
			updatedAt: new Date().toISOString(),
		};
		return writeGoal(root, { ...next, status: statusAfterBudgetLimit(next) });
	});
}

/**
 * Codex `stop_active_goal_for_turn` parity: usage-limit turn errors stop active
 * or budget_limited goals as usage_limited; other terminal turn errors block
 * active goals so idle continuation cannot loop on a failing turn.
 */
export async function stopGoalForTurnError(root: string, sessionID: string, reason: GoalStopReason): Promise<GoalState | undefined> {
	return withGoalLock(root, sessionID, async () => {
		const goal = await readGoal(root, sessionID);
		if (!goal) return undefined;
		const status: GoalStatus = reason === "usage_limit" ? "usage_limited" : "blocked";
		const canStop = goal.status === "active" || (goal.status === "budget_limited" && status === "usage_limited");
		if (!canStop) return goal;
		return writeGoal(root, {
			...goal,
			status,
			lastTurnStartedAt: undefined,
			lastTurnGoalID: undefined,
			updatedAt: new Date().toISOString(),
		});
	});
}

export async function accountUsage(root: string, sessionID: string, usage: StepUsage, expectedGoalID?: string): Promise<GoalState | undefined> {
	return withGoalLock(root, sessionID, async () => {
		const goal = await readGoal(root, sessionID);
		if (!goal || goal.status !== "active") return goal;
		if (expectedGoalID && goal.goalID !== expectedGoalID) return goal;
		if (goal.lastTurnGoalID && goal.lastTurnGoalID !== goal.goalID) return goal;
		// Codex counts (input - cached input) + output, where output includes
		// reasoning. OpenCode input already excludes cache and reports reasoning
		// separately, so the delta is input + output + reasoning.
		const tokenDelta = usage.input + usage.output + usage.reasoning;
		const next: GoalState = {
			...goal,
			tokensUsed: goal.tokensUsed + tokenDelta,
			lastTurnGoalID: undefined,
			updatedAt: new Date().toISOString(),
		};
		return writeGoal(root, { ...next, status: statusAfterBudgetLimit(next) });
	});
}

export async function markTurnStarted(root: string, sessionID: string): Promise<GoalState | undefined> {
	return withGoalLock(root, sessionID, async () => {
		const goal = await readGoal(root, sessionID);
		if (!goal || goal.status !== "active") return goal;
		return writeGoal(root, { ...goal, lastTurnStartedAt: new Date().toISOString(), lastTurnGoalID: goal.goalID, updatedAt: new Date().toISOString() });
	});
}

export async function accountElapsed(root: string, sessionID: string): Promise<GoalState | undefined> {
	return withGoalLock(root, sessionID, async () => {
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
	});
}

export async function recordContinuation(root: string, sessionID: string): Promise<GoalState | undefined> {
	return withGoalLock(root, sessionID, async () => {
		const goal = await readGoal(root, sessionID);
		if (!goal) return undefined;
		return writeGoal(root, { ...goal, continuationsUsed: goal.continuationsUsed + 1, updatedAt: new Date().toISOString() });
	});
}

export async function markBudgetWrapPrompted(root: string, sessionID: string): Promise<GoalState | undefined> {
	return withGoalLock(root, sessionID, async () => {
		const goal = await readGoal(root, sessionID);
		if (!goal) return undefined;
		return writeGoal(root, { ...goal, budgetWrapPrompted: true, updatedAt: new Date().toISOString() });
	});
}
