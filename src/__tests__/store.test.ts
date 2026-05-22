import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { accountUsage, createGoal, deleteGoal, readGoal, recordContinuation, updateGoalObjective, updateGoalStatus } from "../store.js";

async function tempRoot() {
	return mkdtemp(join(import.meta.dir, "tmp-"));
}

describe("goal store", () => {
	test("creates, reads, updates, and deletes project-local goals", async () => {
		const root = await tempRoot();
		await createGoal(root, { sessionID: "session/1", objective: "ship goals" });
		expect((await readGoal(root, "session/1"))?.objective).toBe("ship goals");
		expect((await updateGoalStatus(root, "session/1", "paused"))?.status).toBe("paused");
		expect(await deleteGoal(root, "session/1")).toBe(true);
		expect(await readGoal(root, "session/1")).toBeUndefined();
	});

	test("accounts input plus output and marks budget limited", async () => {
		const root = await tempRoot();
		await createGoal(root, { sessionID: "s1", objective: "ship goals", tokenBudget: 100 });
		expect((await accountUsage(root, "s1", { input: 40, output: 30 }))?.status).toBe("active");
		const goal = await accountUsage(root, "s1", { input: 20, output: 10 });
		expect(goal?.tokensUsed).toBe(100);
		expect(goal?.status).toBe("budget_limited");
	});

	test("records continuation counts", async () => {
		const root = await tempRoot();
		await createGoal(root, { sessionID: "s1", objective: "ship goals" });
		expect((await recordContinuation(root, "s1"))?.continuationsUsed).toBe(1);
	});

	test("edits objective while preserving accounting", async () => {
		const root = await tempRoot();
		await createGoal(root, { sessionID: "s1", objective: "ship goals", tokenBudget: 100 });
		await accountUsage(root, "s1", { input: 30, output: 20 });
		const goal = await updateGoalObjective(root, { sessionID: "s1", objective: "ship more goals", status: "active", tokenBudget: 100 });
		expect(goal?.objective).toBe("ship more goals");
		expect(goal?.tokensUsed).toBe(50);
		expect(goal?.tokenBudget).toBe(100);
	});
});
