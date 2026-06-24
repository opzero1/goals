import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { validateObjective } from "./command.js";
import { buildBudgetLimitPrompt, buildContinuationPrompt, buildGoalSystemPrompt, goalToolResponse } from "./prompts.js";
import { accountElapsed, accountUsage, createGoal, markBudgetWrapPrompted, markTurnStarted, readGoal, recordContinuation, replaceGoal, stopGoalForTurnError, updateGoalStatus } from "./store.js";
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
	const reasoning = readNumber(tokens, "reasoning", "reasoningTokens", "reasoning_tokens");
	return { input, output, reasoning };
}

function readStepAgent(value: unknown): string | undefined {
	const record = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
	const source = record?.info && typeof record.info === "object" ? (record.info as Record<string, unknown>) : record;
	return typeof source?.agent === "string" ? source.agent : undefined;
}

function readSessionError(value: unknown): { name?: string; message?: string; statusCode?: number } | undefined {
	const record = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
	const error = record?.error && typeof record.error === "object" ? (record.error as Record<string, unknown>) : undefined;
	if (!error) return undefined;
	const data = error.data && typeof error.data === "object" ? (error.data as Record<string, unknown>) : undefined;
	return {
		name: typeof error.name === "string" ? error.name : undefined,
		message: typeof data?.message === "string" ? data.message : typeof error.message === "string" ? error.message : undefined,
		statusCode: typeof data?.statusCode === "number" ? data.statusCode : undefined,
	};
}

const USAGE_LIMIT_PATTERN = /usage.?limit|rate.?limit|quota|too many requests/i;

function isUsageLimitError(error: { name?: string; message?: string; statusCode?: number }): boolean {
	if (error.statusCode === 429) return true;
	return error.message !== undefined && USAGE_LIMIT_PATTERN.test(error.message);
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
		const sessionAgents = new Map<string, string>();
		// Codex parity: user interrupts do not emit the thread-idle lifecycle, so an
		// aborted turn must not trigger automatic continuation until the next turn.
		const abortedSessions = new Set<string>();

		function cancelContinuation(sessionID: string) {
			const timer = pending.get(sessionID);
			if (timer === undefined) return;
			clearTimeout(timer);
			pending.delete(sessionID);
		}

		async function scheduleContinuation(sessionID: string) {
			if (pending.has(sessionID)) return;
			if (abortedSessions.has(sessionID)) return;
			// Codex gates automatic idle turns in Plan mode (#26147).
			if (sessionAgents.get(sessionID) === "plan") return;
			pending.set(
				sessionID,
				setTimeout(async () => {
					pending.delete(sessionID);
					if (abortedSessions.has(sessionID)) return;
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
						"Create a goal only when explicitly requested by the user or system/developer instructions; do not infer goals from ordinary tasks.\nSet token_budget only when an explicit token budget is requested. Fails if an unfinished goal exists; use update_goal only for status.",
					args: {
						objective: schema
							.string()
							.min(1)
							.max(4000)
							.describe("Required. The concrete objective to start pursuing. This starts a new active goal when no goal exists or replaces the current goal when it is complete."),
						token_budget: schema.number().int().nonnegative().optional().describe("Optional token budget for the new goal. Omit unless explicitly requested; 0 is treated as omitted/unlimited."),
					},
					async execute(args, context) {
						const storeRoot = await resolveStoreRoot(context.worktree, context.directory, root);
						const existing = await readGoal(storeRoot, context.sessionID);
						if (existing && existing.status !== "complete") return "cannot create a new goal because this thread has an unfinished goal; complete the existing goal first";
						const error = validateObjective(args.objective);
						if (error) return error;
						const make = existing ? replaceGoal : createGoal;
						return goalToolResponse(await make(storeRoot, { sessionID: context.sessionID, objective: args.objective, tokenBudget: args.token_budget }));
					},
				}),
				update_goal: tool({
					description: [
						"Update the existing goal.",
						"Use this tool only to mark the goal achieved or genuinely blocked.",
						"Set status to `complete` only when the objective has actually been achieved and no required work remains.",
						"Set status to `blocked` only when the same blocking condition has repeated for at least three consecutive goal turns, counting the original/user-triggered turn and any automatic continuations, and the agent cannot make meaningful progress without user input or an external-state change.",
						"If the user resumes a goal that was previously marked `blocked`, treat the resumed run as a fresh blocked audit. If the same blocking condition then repeats for at least three consecutive resumed goal turns, set status to `blocked` again.",
						"Once the blocked threshold is satisfied, do not keep reporting that you are still blocked while leaving the goal active; set status to `blocked`.",
						"Do not use `blocked` merely because the work is hard, slow, uncertain, incomplete, or would benefit from clarification.",
						"Do not mark a goal complete merely because its budget is nearly exhausted or because you are stopping work.",
						"You cannot use this tool to pause, resume, budget-limit, or usage-limit a goal; those status changes are controlled by the user or system.",
						"When marking a budgeted goal achieved with status `complete`, report the final token usage from the tool result to the user.",
					].join("\n"),
					args: {
						status: schema
							.enum(["complete", "blocked"])
							.describe(
								"Required. Set to `complete` only when the objective is achieved and no required work remains. Set to `blocked` only after the same blocking condition has recurred for at least three consecutive goal turns and the agent is at an impasse. After a previously blocked goal is resumed, the resumed run starts a fresh blocked audit.",
							),
					},
					async execute(args, context) {
						const storeRoot = await resolveStoreRoot(context.worktree, context.directory, root);
						await accountElapsed(storeRoot, context.sessionID);
						const goal = await updateGoalStatus(storeRoot, context.sessionID, args.status);
						if (!goal) return "cannot update goal because this thread has no goal";
						return goalToolResponse(goal, args.status === "complete");
					},
				}),
			},
			async event(eventInput) {
				const event = eventInput.event as { type?: string; properties?: unknown };
				const sessionID = readSessionID(event.properties);
				if (!sessionID) return;
				if (event.type === "session.next.step.started") {
					// A new turn started: continuation must only launch from idle, and a
					// previous abort no longer suppresses it (codex try_start_turn_if_idle).
					cancelContinuation(sessionID);
					abortedSessions.delete(sessionID);
					const agent = readStepAgent(event.properties);
					if (agent) sessionAgents.set(sessionID, agent);
					const goal = await markTurnStarted(root, sessionID);
					if (goal?.status === "active") turnGoalIDs.set(sessionID, goal.goalID);
					else turnGoalIDs.delete(sessionID);
				}
				if (event.type === "session.next.step.ended") {
					const expectedGoalID = turnGoalIDs.get(sessionID);
					turnGoalIDs.delete(sessionID);
					await accountUsage(root, sessionID, readStepUsage(event.properties), expectedGoalID);
				}
				if (event.type === "session.error") {
					const error = readSessionError(event.properties);
					if (!error) return;
					await accountElapsed(root, sessionID);
					if (error.name === "MessageAbortedError") {
						// User interrupt: keep the goal but skip continuation until the next turn.
						abortedSessions.add(sessionID);
						cancelContinuation(sessionID);
						return;
					}
					// Terminal turn error: stop the active goal so idle continuation cannot
					// loop on a failing turn (codex #26690 / #25095).
					await stopGoalForTurnError(root, sessionID, isUsageLimitError(error) ? "usage_limit" : "turn_error");
				}
				// session.idle is deprecated upstream and carries no status payload; the
				// event itself signals idle. session.status carries { status: { type } }.
				const idle = event.type === "session.idle" || (event.type === "session.status" && isIdleStatus(event.properties));
				if (idle) await scheduleContinuation(sessionID);
			},
			async dispose() {
				for (const timer of pending.values()) clearTimeout(timer);
				pending.clear();
				turnGoalIDs.clear();
				sessionAgents.clear();
				abortedSessions.clear();
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
