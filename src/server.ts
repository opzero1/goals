import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { validateObjective } from "./command.js";
import { buildBudgetLimitPrompt, buildContinuationPrompt, buildGoalSystemPrompt, goalToolResponse } from "./prompts.js";
import { accountElapsed, accountUsage, createGoal, markBudgetWrapPrompted, markTurnStarted, readGoal, recordContinuation, updateGoalStatus } from "./store.js";
import { DEFAULT_GOAL_OPTIONS, type GoalOptions } from "./types.js";

type Client = { session?: { promptAsync?: (input: unknown) => Promise<{ error?: unknown }> } };
const schema = tool.schema;
const fallbackRoot = join(homedir(), ".local", "share", "opencode", "goals-plugin");

async function resolveStoreRoot(...candidates: Array<string | undefined>): Promise<string> {
	for (const candidate of candidates) {
		if (!candidate) continue;
		const root = resolve(candidate);
		if (root === "/") continue;
		try {
			await mkdir(join(root, ".opencode"), { recursive: true });
			return root;
		} catch {
			// Try the next candidate, then fall back to opencode's user data area.
		}
	}
	await mkdir(fallbackRoot, { recursive: true });
	return fallbackRoot;
}

function readSessionID(value: unknown): string | undefined {
	const record = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
	if (!record) return undefined;
	return [record.sessionID, record.sessionId, record.session_id, record.id].find((item): item is string => typeof item === "string" && item.length > 0);
}

function readStepUsage(value: unknown) {
	const record = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
	const source = record?.info && typeof record.info === "object" ? (record.info as Record<string, unknown>) : record;
	const tokens = source?.tokens && typeof source.tokens === "object" ? (source.tokens as Record<string, unknown>) : undefined;
	const input = readNumber(tokens, "input", "inputTokens", "input_tokens");
	const output = readNumber(tokens, "output", "outputTokens", "output_tokens");
	return { input, output };
}

function readNumber(record: Record<string, unknown> | undefined, ...keys: string[]): number {
	for (const key of keys) {
		const value = record?.[key];
		if (typeof value === "number" && Number.isFinite(value)) return value;
	}
	return 0;
}

function isIdleStatus(value: unknown): boolean {
	const record = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
	const status = record?.status && typeof record.status === "object" ? (record.status as Record<string, unknown>) : record;
	return status?.type === "idle";
}

async function promptAsync(client: Client, sessionID: string, text: string) {
	await client.session?.promptAsync?.({
		path: { id: sessionID },
		body: { parts: [{ type: "text", text }] },
	});
}

export function GoalsServerPlugin(options: Partial<GoalOptions> = {}): Plugin {
	return async (input) => {
		const root = await resolveStoreRoot(input.worktree, input.directory);
		const mergedOptions = { ...DEFAULT_GOAL_OPTIONS, ...options };
		const pending = new Map<string, Timer>();
		const turnGoalIDs = new Map<string, string>();

		async function scheduleContinuation(sessionID: string) {
			if (pending.has(sessionID)) return;
			pending.set(
				sessionID,
				setTimeout(async () => {
					pending.delete(sessionID);
					const goal = await accountElapsed(root, sessionID);
					if (!goal) return;
					if (goal.status === "budget_limited" && !goal.budgetWrapPrompted) {
						await markBudgetWrapPrompted(root, sessionID);
						await promptAsync(input.client as Client, sessionID, buildBudgetLimitPrompt(goal));
						return;
					}
					if (goal.status !== "active") return;
					if (goal.continuationsUsed >= mergedOptions.maxContinuations) {
						await updateGoalStatus(root, sessionID, "paused");
						return;
					}
					await recordContinuation(root, sessionID);
					await promptAsync(input.client as Client, sessionID, buildContinuationPrompt(goal));
				}, mergedOptions.idleDelayMs),
			);
		}

		return {
			tool: {
				get_goal: tool({
					description: "Get the current goal for this thread, including status, budgets, token and elapsed-time usage, and remaining token budget.",
					args: {},
					async execute(_, context) {
						const goal = await readGoal(await resolveStoreRoot(context.worktree, context.directory, root), context.sessionID);
						return goalToolResponse(goal);
					},
				}),
				create_goal: tool({
					description:
						"Create a goal only when explicitly requested by the user or system/developer instructions; do not infer goals from ordinary tasks. Set token_budget only when an explicit token budget is requested. Fails if a goal exists; use update_goal only for status.",
					args: {
						objective: schema.string().min(1).max(4000),
						token_budget: schema.number().int().positive().optional(),
					},
					async execute(args, context) {
						const storeRoot = await resolveStoreRoot(context.worktree, context.directory, root);
						if (await readGoal(storeRoot, context.sessionID)) return "cannot create a new goal because this thread already has a goal; use update_goal only when the existing goal is complete";
						const error = validateObjective(args.objective);
						if (error) return error;
						return goalToolResponse(await createGoal(storeRoot, { sessionID: context.sessionID, objective: args.objective, tokenBudget: args.token_budget }));
					},
				}),
				update_goal: tool({
					description:
						"Update the existing goal. Use this tool only to mark the goal achieved. Set status to complete only when the objective has actually been achieved and no required work remains. Do not mark a goal complete merely because its budget is nearly exhausted or because you are stopping work. You cannot use this tool to pause, resume, or budget-limit a goal; those status changes are controlled by the user or system. When marking a budgeted goal achieved with status complete, report the final token usage from the tool result to the user.",
					args: { status: schema.enum(["complete"]) },
					async execute(args, context) {
						const storeRoot = await resolveStoreRoot(context.worktree, context.directory, root);
						await accountElapsed(storeRoot, context.sessionID);
						const goal = await updateGoalStatus(storeRoot, context.sessionID, args.status);
						return goal ? goalToolResponse(goal, args.status === "complete") : goalToolResponse(undefined);
					},
				}),
			},
			async event(eventInput) {
				const event = eventInput.event as { type?: string; properties?: unknown };
				const sessionID = readSessionID(event.properties);
				if (!sessionID) return;
				if (event.type === "session.next.step.started") {
					const goal = await markTurnStarted(root, sessionID);
					if (goal?.status === "active") turnGoalIDs.set(sessionID, goal.goalID);
					else turnGoalIDs.delete(sessionID);
				}
				if (event.type === "session.next.step.ended") {
					const expectedGoalID = turnGoalIDs.get(sessionID);
					turnGoalIDs.delete(sessionID);
					await accountUsage(root, sessionID, readStepUsage(event.properties), expectedGoalID);
				}
				if ((event.type === "session.status" || event.type === "session.idle") && isIdleStatus(event.properties)) await scheduleContinuation(sessionID);
			},
			async "experimental.chat.system.transform"(hookInput, output) {
				if (!hookInput.sessionID) return;
				const goal = await readGoal(root, hookInput.sessionID);
				if (!goal || goal.status !== "active") return;
				output.system.push(buildGoalSystemPrompt(goal));
			},
		};
	};
}
