import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { accountUsage, createGoal, deleteGoal, readGoal, recordContinuation, replaceGoal, stopGoalForTurnError, updateGoalObjective, updateGoalStatus, writeGoal } from "../store.js";

async function tempRoot() {
	return mkdtemp(join(tmpdir(), "opencode-goals-test-"));
}

describe("goal store", () => {
	test("creates, reads, updates, and deletes project-local goals", async () => {
		const root = await tempRoot();
		await createGoal(root, { sessionID: "session/1", objective: "ship goals" });
		const created = await readGoal(root, "session/1");
		expect(created?.objective).toBe("ship goals");
		expect(typeof created?.goalID).toBe("string");
		expect((await updateGoalStatus(root, "session/1", "paused"))?.status).toBe("paused");
		expect(await deleteGoal(root, "session/1")).toBe(true);
		expect(await readGoal(root, "session/1")).toBeUndefined();
	});

	test("accounts input plus output plus reasoning and marks budget limited", async () => {
		const root = await tempRoot();
		await createGoal(root, { sessionID: "s1", objective: "ship goals", tokenBudget: 100 });
		expect((await accountUsage(root, "s1", { input: 30, output: 20, reasoning: 20 }))?.status).toBe("active");
		const goal = await accountUsage(root, "s1", { input: 10, output: 10, reasoning: 10 });
		expect(goal?.tokensUsed).toBe(100);
		expect(goal?.status).toBe("budget_limited");
	});

	test("accounts OpenCode non-cached input, output, and reasoning tokens", async () => {
		const root = await tempRoot();
		await createGoal(root, { sessionID: "s1", objective: "ship goals", tokenBudget: 100 });
		const goal = await accountUsage(root, "s1", { input: 40, output: 10, reasoning: 5 });
		expect(goal?.tokensUsed).toBe(55);
		expect(goal?.status).toBe("active");
	});

	test("treats zero token budgets as unlimited", async () => {
		const root = await tempRoot();
		await createGoal(root, { sessionID: "s1", objective: "ship goals", tokenBudget: 0 });
		const goal = await accountUsage(root, "s1", { input: 40, output: 10, reasoning: 5 });
		expect(goal?.tokenBudget).toBeUndefined();
		expect(goal?.tokensUsed).toBe(55);
		expect(goal?.status).toBe("active");

		const now = new Date().toISOString();
		await writeGoal(root, {
			sessionID: "persisted-zero",
			goalID: "goal-id",
			objective: "ship goals",
			status: "budget_limited",
			tokenBudget: 0,
			tokensUsed: 1,
			timeUsedSeconds: 0,
			continuationsUsed: 0,
			budgetWrapPrompted: false,
			createdAt: now,
			updatedAt: now,
		});
		const persisted = await readGoal(root, "persisted-zero");
		expect(persisted?.tokenBudget).toBeUndefined();
		expect(persisted?.status).toBe("active");
	});

	test("supports Codex goal lifecycle statuses", async () => {
		const root = await tempRoot();
		await createGoal(root, { sessionID: "s1", objective: "ship goals" });
		await recordContinuation(root, "s1");
		expect((await updateGoalStatus(root, "s1", "paused"))?.status).toBe("paused");
		const resumed = await updateGoalStatus(root, "s1", "active");
		expect(resumed?.status).toBe("active");
		expect(resumed?.continuationsUsed).toBe(0);
		expect((await updateGoalStatus(root, "s1", "complete"))?.status).toBe("complete");
	});

	test("marks blocked goals and resumes them with a fresh continuation budget", async () => {
		const root = await tempRoot();
		await createGoal(root, { sessionID: "s1", objective: "ship goals" });
		await recordContinuation(root, "s1");
		expect((await updateGoalStatus(root, "s1", "blocked"))?.status).toBe("blocked");
		const resumed = await updateGoalStatus(root, "s1", "active");
		expect(resumed?.status).toBe("active");
		expect(resumed?.continuationsUsed).toBe(0);
	});

	test("stops active goals on terminal turn errors", async () => {
		const root = await tempRoot();
		await createGoal(root, { sessionID: "s1", objective: "ship goals" });
		expect((await stopGoalForTurnError(root, "s1", "turn_error"))?.status).toBe("blocked");
		await updateGoalStatus(root, "s1", "active");
		expect((await stopGoalForTurnError(root, "s1", "usage_limit"))?.status).toBe("usage_limited");
	});

	test("usage-limit errors stop budget_limited goals but other errors do not", async () => {
		const root = await tempRoot();
		await createGoal(root, { sessionID: "s1", objective: "ship goals", tokenBudget: 10 });
		await accountUsage(root, "s1", { input: 10, output: 5, reasoning: 0 });
		expect((await readGoal(root, "s1"))?.status).toBe("budget_limited");
		expect((await stopGoalForTurnError(root, "s1", "turn_error"))?.status).toBe("budget_limited");
		expect((await stopGoalForTurnError(root, "s1", "usage_limit"))?.status).toBe("usage_limited");
	});

	test("does not stop paused or complete goals on turn errors", async () => {
		const root = await tempRoot();
		await createGoal(root, { sessionID: "s1", objective: "ship goals" });
		await updateGoalStatus(root, "s1", "paused");
		expect((await stopGoalForTurnError(root, "s1", "turn_error"))?.status).toBe("paused");
	});

	test("records continuation counts", async () => {
		const root = await tempRoot();
		await createGoal(root, { sessionID: "s1", objective: "ship goals" });
		expect((await recordContinuation(root, "s1"))?.continuationsUsed).toBe(1);
	});

	test("edits objective while preserving accounting", async () => {
		const root = await tempRoot();
		await createGoal(root, { sessionID: "s1", objective: "ship goals", tokenBudget: 100 });
		await accountUsage(root, "s1", { input: 30, output: 20, reasoning: 0 });
		const goal = await updateGoalObjective(root, { sessionID: "s1", objective: "ship more goals", status: "active", tokenBudget: 100 });
		expect(goal?.objective).toBe("ship more goals");
		expect(goal?.tokensUsed).toBe(50);
		expect(goal?.tokenBudget).toBe(100);
	});

	test("keeps over-budget goals budget_limited until the budget is raised", async () => {
		const root = await tempRoot();
		await createGoal(root, { sessionID: "s1", objective: "ship goals", tokenBudget: 10 });
		await accountUsage(root, "s1", { input: 10, output: 5, reasoning: 0 });
		const stillLimited = await updateGoalObjective(root, { sessionID: "s1", objective: "ship goals", status: "active", tokenBudget: 10 });
		expect(stillLimited?.status).toBe("budget_limited");
		const extended = await updateGoalObjective(root, { sessionID: "s1", objective: "ship goals", tokenBudget: 100 });
		expect(extended?.status).toBe("active");
	});

	test("replaces complete goals with fresh accounting", async () => {
		const root = await tempRoot();
		await createGoal(root, { sessionID: "s1", objective: "ship goals", tokenBudget: 10 });
		await accountUsage(root, "s1", { input: 4, output: 2, reasoning: 0 });
		await updateGoalStatus(root, "s1", "complete");
		const replaced = await replaceGoal(root, { sessionID: "s1", objective: "ship the next thing" });
		expect(replaced.status).toBe("active");
		expect(replaced.tokensUsed).toBe(0);
		expect(replaced.objective).toBe("ship the next thing");
	});

	test("serializes concurrent accounting updates", async () => {
		const root = await tempRoot();
		await createGoal(root, { sessionID: "s1", objective: "ship goals" });
		await Promise.all(Array.from({ length: 10 }, () => accountUsage(root, "s1", { input: 1, output: 1, reasoning: 1 })));
		expect((await readGoal(root, "s1"))?.tokensUsed).toBe(30);
	});
});
