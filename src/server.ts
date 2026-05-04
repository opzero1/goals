import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { validateObjective } from "./command.js";
import { buildBudgetLimitPrompt, buildContinuationPrompt, buildGoalSystemPrompt, formatGoalSummary } from "./prompts.js";
import { accountElapsed, accountUsage, createGoal, markBudgetWrapPrompted, markTurnStarted, readGoal, recordContinuation, updateGoalStatus } from "./store.js";
import { DEFAULT_GOAL_OPTIONS, type GoalOptions } from "./types.js";

type Client = { session?: { promptAsync?: (input: unknown) => Promise<{ error?: unknown }> } };
const schema = tool.schema;

function readSessionID(value: unknown): string | undefined {
	const record = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
	if (!record) return undefined;
	return [record.sessionID, record.sessionId, record.session_id, record.id].find((item): item is string => typeof item === "string" && item.length > 0);
}

function readStepUsage(value: unknown) {
	const record = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
	const tokens = record?.tokens && typeof record.tokens === "object" ? (record.tokens as Record<string, unknown>) : undefined;
	const input = typeof tokens?.input === "number" ? tokens.input : 0;
	const output = typeof tokens?.output === "number" ? tokens.output : 0;
	return { input, output };
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
		const root = input.worktree || input.directory;
		const mergedOptions = { ...DEFAULT_GOAL_OPTIONS, ...options };
		const pending = new Map<string, Timer>();

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
					if (goal.continuationsUsed >= mergedOptions.maxContinuations) return;
					await recordContinuation(root, sessionID);
					await promptAsync(input.client as Client, sessionID, buildContinuationPrompt(goal));
				}, mergedOptions.idleDelayMs),
			);
		}

		return {
			tool: {
				get_goal: tool({
					description: "Read the active goal for this OpenCode session, including status, token use, and budget.",
					args: {},
					async execute(_, context) {
						const goal = await readGoal(context.worktree || context.directory || root, context.sessionID);
						return goal ? formatGoalSummary(goal) : "No goal is currently set.";
					},
				}),
				create_goal: tool({
					description: "Create a goal only when explicitly requested by the user or higher-priority instructions. Fails if a goal already exists.",
					args: {
						objective: schema.string().min(1).max(4000),
						token_budget: schema.number().int().positive().optional(),
					},
					async execute(args, context) {
						const storeRoot = context.worktree || context.directory || root;
						if (await readGoal(storeRoot, context.sessionID)) return "A goal already exists. Ask the user to replace or clear it with /goal.";
						const error = validateObjective(args.objective);
						if (error) return error;
						return formatGoalSummary(await createGoal(storeRoot, { sessionID: context.sessionID, objective: args.objective, tokenBudget: args.token_budget }));
					},
				}),
				update_goal: tool({
					description: "Mark the current goal complete only after auditing that the objective has actually been achieved.",
					args: { status: schema.literal("complete") },
					async execute(_, context) {
						const goal = await updateGoalStatus(context.worktree || context.directory || root, context.sessionID, "complete");
						return goal ? formatGoalSummary(goal) : "No goal is currently set.";
					},
				}),
			},
			async event(eventInput) {
				const event = eventInput.event as { type?: string; properties?: unknown };
				const sessionID = readSessionID(event.properties);
				if (!sessionID) return;
				if (event.type === "session.next.step.started") await markTurnStarted(root, sessionID);
				if (event.type === "session.next.step.ended") await accountUsage(root, sessionID, readStepUsage(event.properties));
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
