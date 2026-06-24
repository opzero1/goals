import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { GoalsServerPlugin } from "../server.js";
import { readGoal } from "../store.js";

const IDLE_DELAY_MS = 5;

type Hooks = {
	tool: Record<string, { description: string; execute: (args: Record<string, unknown>, context: { sessionID: string; worktree: string; directory: string }) => Promise<string> }>;
	event: (input: { event: { type: string; properties: Record<string, unknown> } }) => Promise<void>;
	dispose: () => Promise<void>;
	"experimental.chat.system.transform": (input: { sessionID?: string }, output: { system: string[] }) => Promise<void>;
};

async function harness(options: Record<string, unknown> = {}) {
	const root = await mkdtemp(join(tmpdir(), "opencode-goals-server-"));
	const prompts: string[] = [];
	const client = {
		session: {
			promptAsync: async (input: unknown) => {
				const body = (input as { body?: { parts?: Array<{ text?: string }> } }).body;
				prompts.push(body?.parts?.[0]?.text ?? "");
				return {};
			},
		},
	};
	const plugin = GoalsServerPlugin({ idleDelayMs: IDLE_DELAY_MS, ...options });
	const hooks = (await plugin({ worktree: root, directory: root, client } as never)) as unknown as Hooks;
	const context = { sessionID: "s1", worktree: root, directory: root };

	return {
		root,
		prompts,
		hooks,
		context,
		createGoal: (objective: string, tokenBudget?: number) => hooks.tool.create_goal.execute({ objective, token_budget: tokenBudget }, context),
		stepStarted: (agent = "build") => hooks.event({ event: { type: "session.next.step.started", properties: { sessionID: "s1", agent } } }),
		stepEnded: (tokens: { input: number; output: number; reasoning: number }) =>
			hooks.event({ event: { type: "session.next.step.ended", properties: { sessionID: "s1", tokens: { ...tokens, cache: { read: 0, write: 0 } } } } }),
		idle: () => hooks.event({ event: { type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } } }),
		error: (error: Record<string, unknown>) => hooks.event({ event: { type: "session.error", properties: { sessionID: "s1", error } } }),
		settle: () => Bun.sleep(IDLE_DELAY_MS * 4),
	};
}

describe("goals server plugin", () => {
	test("creates a goal, continues on idle, and injects goal context", async () => {
		const h = await harness();
		await h.createGoal("ship the feature");

		const system: string[] = [];
		await h.hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, { system });
		expect(system.join("\n")).toContain("ship the feature");

		await h.stepStarted();
		await h.stepEnded({ input: 10, output: 5, reasoning: 2 });
		await h.idle();
		await h.settle();

		expect(h.prompts).toHaveLength(1);
		expect(h.prompts[0]).toContain("Continue working toward the active thread goal.");
		expect(h.prompts[0]).toContain("Blocked audit:");
		expect((await readGoal(h.root, "s1"))?.tokensUsed).toBe(17);
		await h.hooks.dispose();
	});

	test("create_goal rejects unfinished goals and replaces complete ones", async () => {
		const h = await harness();
		await h.createGoal("first objective");
		expect(await h.createGoal("second objective")).toBe("cannot create a new goal because this thread has an unfinished goal; complete the existing goal first");

		await h.hooks.tool.update_goal.execute({ status: "complete" }, h.context);
		const replaced = JSON.parse(await h.createGoal("second objective"));
		expect(replaced.goal.objective).toBe("second objective");
		expect(replaced.goal.status).toBe("active");
		await h.hooks.dispose();
	});

	test("create_goal treats token_budget 0 as unlimited", async () => {
		const h = await harness();
		const created = JSON.parse(await h.createGoal("ship the feature", 0));
		expect(created.goal.tokenBudget).toBeUndefined();

		await h.stepStarted();
		await h.stepEnded({ input: 10, output: 5, reasoning: 0 });
		expect((await readGoal(h.root, "s1"))?.status).toBe("active");

		await h.idle();
		await h.settle();
		expect(h.prompts).toHaveLength(1);
		expect(h.prompts[0]).toContain("Continue working toward the active thread goal.");
		await h.hooks.dispose();
	});

	test("update_goal marks goals blocked and stops continuation", async () => {
		const h = await harness();
		await h.createGoal("ship the feature");
		const result = JSON.parse(await h.hooks.tool.update_goal.execute({ status: "blocked" }, h.context));
		expect(result.goal.status).toBe("blocked");

		await h.idle();
		await h.settle();
		expect(h.prompts).toHaveLength(0);
		await h.hooks.dispose();
	});

	test("update_goal without a goal returns the codex message", async () => {
		const h = await harness();
		expect(await h.hooks.tool.update_goal.execute({ status: "complete" }, h.context)).toBe("cannot update goal because this thread has no goal");
		await h.hooks.dispose();
	});

	test("user aborts suppress continuation until the next turn", async () => {
		const h = await harness();
		await h.createGoal("ship the feature");
		await h.stepStarted();
		await h.error({ name: "MessageAbortedError", data: { message: "aborted" } });
		await h.idle();
		await h.settle();
		expect(h.prompts).toHaveLength(0);
		expect((await readGoal(h.root, "s1"))?.status).toBe("active");

		// The next turn clears the suppression.
		await h.stepStarted();
		await h.stepEnded({ input: 1, output: 1, reasoning: 0 });
		await h.idle();
		await h.settle();
		expect(h.prompts).toHaveLength(1);
		await h.hooks.dispose();
	});

	test("terminal turn errors block the goal; 429s mark it usage limited", async () => {
		const h = await harness();
		await h.createGoal("ship the feature");
		await h.error({ name: "APIError", data: { message: "boom", isRetryable: false } });
		expect((await readGoal(h.root, "s1"))?.status).toBe("blocked");

		await h.hooks.tool.update_goal.execute({ status: "complete" }, h.context);
		await h.createGoal("next objective");
		await h.error({ name: "APIError", data: { message: "slow down", statusCode: 429, isRetryable: true } });
		expect((await readGoal(h.root, "s1"))?.status).toBe("usage_limited");
		await h.hooks.dispose();
	});

	test("plan-mode sessions are not auto-continued", async () => {
		const h = await harness();
		await h.createGoal("ship the feature");
		await h.stepStarted("plan");
		await h.stepEnded({ input: 1, output: 1, reasoning: 0 });
		await h.idle();
		await h.settle();
		expect(h.prompts).toHaveLength(0);

		await h.stepStarted("build");
		await h.stepEnded({ input: 1, output: 1, reasoning: 0 });
		await h.idle();
		await h.settle();
		expect(h.prompts).toHaveLength(1);
		await h.hooks.dispose();
	});

	test("budget exhaustion sends a single wrap-up prompt", async () => {
		const h = await harness();
		await h.createGoal("ship the feature", 10);
		await h.stepStarted();
		await h.stepEnded({ input: 10, output: 5, reasoning: 0 });
		await h.idle();
		await h.settle();
		await h.idle();
		await h.settle();

		expect(h.prompts).toHaveLength(1);
		expect(h.prompts[0]).toContain("has reached its token budget");
		expect((await readGoal(h.root, "s1"))?.status).toBe("budget_limited");
		await h.hooks.dispose();
	});

	test("continuation cap pauses the goal", async () => {
		const h = await harness({ maxContinuations: 1 });
		await h.createGoal("ship the feature");
		await h.idle();
		await h.settle();
		expect(h.prompts).toHaveLength(1);

		await h.idle();
		await h.settle();
		expect(h.prompts).toHaveLength(1);
		expect((await readGoal(h.root, "s1"))?.status).toBe("paused");
		await h.hooks.dispose();
	});

	test("a new turn cancels a pending continuation", async () => {
		const h = await harness({ idleDelayMs: 50 });
		await h.createGoal("ship the feature");
		await h.idle();
		await h.stepStarted();
		await Bun.sleep(120);
		expect(h.prompts).toHaveLength(0);
		await h.hooks.dispose();
	});

	test("dispose cancels pending continuations", async () => {
		const h = await harness({ idleDelayMs: 50 });
		await h.createGoal("ship the feature");
		await h.idle();
		await h.hooks.dispose();
		await Bun.sleep(120);
		expect(h.prompts).toHaveLength(0);
	});

	test("system transform skips inactive goals", async () => {
		const h = await harness();
		await h.createGoal("ship the feature");
		await h.hooks.tool.update_goal.execute({ status: "blocked" }, h.context);
		const system: string[] = [];
		await h.hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, { system });
		expect(system).toHaveLength(0);
		await h.hooks.dispose();
	});
});
