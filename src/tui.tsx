import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { parseGoalCommand, validateObjective } from "./command.js";
import { buildObjectiveUpdatedPrompt, formatGoalSummary, GOAL_USAGE } from "./prompts.js";
import { createGoal, deleteGoal, readGoal, replaceGoal, RESUMABLE_STATUSES, updateGoalObjective, updateGoalStatus } from "./store.js";

function getRouteSessionID(api: TuiPluginApi): string | undefined {
	const sessionID = api.route.current.name === "session" ? api.route.current.params?.sessionID : undefined;
	return typeof sessionID === "string" ? sessionID : undefined;
}

function sessionIsRunning(api: TuiPluginApi, sessionID: string): boolean {
	const status = api.state.session.status(sessionID);
	return status?.type === "busy" || status?.type === "retry";
}

async function showGoal(api: TuiPluginApi, root: string, sessionID: string) {
	const goal = await readGoal(root, sessionID);
	api.ui.toast({ message: goal ? formatGoalSummary(goal) : `No goal is currently set. ${GOAL_USAGE}`, variant: "info" });
}

async function setGoal(api: TuiPluginApi, root: string, sessionID: string, objective: string, tokenBudget?: number) {
	const error = validateObjective(objective);
	if (error) {
		api.ui.toast({ message: error, variant: "error" });
		return;
	}
	const existing = await readGoal(root, sessionID);
	if (existing && existing.status !== "complete") {
		api.ui.dialog.replace(() => (
			<api.ui.DialogConfirm
				title="Replace goal?"
				message={`New objective: ${objective}`}
				onConfirm={async () => {
					api.ui.dialog.clear();
					await replaceGoal(root, { sessionID, objective, tokenBudget });
					api.ui.toast({ message: "Goal replaced", variant: "success" });
				}}
			/>
		));
		return;
	}
	await createGoal(root, { sessionID, objective, tokenBudget });
	api.ui.toast({ message: "Goal set", variant: "success" });
}

async function editGoal(api: TuiPluginApi, root: string, sessionID: string) {
	const goal = await readGoal(root, sessionID);
	if (!goal) {
		api.ui.toast({ message: "No goal to edit", variant: "info" });
		return;
	}
	api.ui.dialog.replace(() => (
		<api.ui.DialogPrompt
			title="Edit goal"
			placeholder="Type a goal objective and press Enter"
			value={goal.objective}
			onConfirm={async (value) => {
				api.ui.dialog.clear();
				const error = validateObjective(value);
				if (error) {
					api.ui.toast({ message: error, variant: "error" });
					return;
				}
				const updated = await updateGoalObjective(root, {
					sessionID,
					objective: value,
					// Editing a finished goal restarts pursuit; budget recompute in the
					// store keeps over-budget goals budget_limited (codex parity).
					status: goal.status === "complete" ? "active" : goal.status,
					tokenBudget: goal.tokenBudget,
				});
				api.ui.toast({ message: "Goal updated", variant: "success" });
				// Codex injects objective-updated steering only into a running turn
				// (inject_if_running); when idle the next turn picks up the new
				// objective from goal context instead.
				if (updated && updated.status === "active" && sessionIsRunning(api, sessionID)) {
					await api.client.session
						.promptAsync({
							sessionID,
							parts: [{ type: "text", text: buildObjectiveUpdatedPrompt(updated) }],
						})
						.catch(() => undefined);
				}
			}}
		/>
	));
}

async function runGoalCommand(api: TuiPluginApi, root: string, args: string, activeSessionID?: string) {
	const sessionID = getRouteSessionID(api) ?? activeSessionID;
	if (!sessionID) {
		api.ui.toast({ message: "Start or select a session before using /goal.", variant: "error" });
		return;
	}
	const command = parseGoalCommand(args);
	if (command.action === "show") return showGoal(api, root, sessionID);
	if (command.action === "edit") return editGoal(api, root, sessionID);
	if (command.action === "set") return setGoal(api, root, sessionID, command.objective ?? "", command.tokenBudget);
	if (command.action === "pause") {
		const goal = await readGoal(root, sessionID);
		if (!goal) {
			api.ui.toast({ message: "No goal to pause", variant: "info" });
			return;
		}
		if (goal.status !== "active") {
			api.ui.toast({ message: `Goal is ${goal.status.replace("_", " ")}; only active goals can be paused.`, variant: "info" });
			return;
		}
		await updateGoalStatus(root, sessionID, "paused");
		api.ui.toast({ message: "Goal paused", variant: "info" });
		return;
	}
	if (command.action === "resume") {
		const goal = await readGoal(root, sessionID);
		if (!goal) {
			api.ui.toast({ message: "No goal to resume", variant: "info" });
			return;
		}
		if (goal.status === "active") {
			api.ui.toast({ message: "Goal is already active", variant: "info" });
			return;
		}
		if (goal.status === "complete") {
			api.ui.toast({ message: "Goal is complete; set a new objective with /goal <objective>.", variant: "info" });
			return;
		}
		if (!RESUMABLE_STATUSES.has(goal.status)) {
			api.ui.toast({ message: "Goal is limited by budget; replace it with /goal <objective> to continue.", variant: "info" });
			return;
		}
		await updateGoalStatus(root, sessionID, "active");
		api.ui.toast({ message: "Goal resumed", variant: "success" });
		return;
	}
	if (await deleteGoal(root, sessionID)) api.ui.toast({ message: "Goal cleared", variant: "info" });
	else api.ui.toast({ message: "No goal to clear", variant: "info" });
}

function readSessionID(properties: unknown): string | undefined {
	const record = properties && typeof properties === "object" ? (properties as Record<string, unknown>) : undefined;
	const sessionID = record?.sessionID ?? record?.sessionId ?? record?.session_id;
	return typeof sessionID === "string" ? sessionID : undefined;
}

export async function installGoalsPlugin(api: TuiPluginApi): Promise<void> {
	const root = api.state.path.directory || process.cwd();
	let activeSessionID: string | undefined;
	const setActiveSession = (sessionID?: string) => {
		if (!sessionID) return;
		activeSessionID = sessionID;
	};

	const openGoalDialog = () => {
		const commandSessionID = getRouteSessionID(api) ?? activeSessionID;
		api.ui.dialog.replace(() => (
			<api.ui.DialogPrompt
				title="Goal"
				placeholder="improve benchmark coverage"
				onConfirm={async (value) => {
					api.ui.dialog.clear();
					await runGoalCommand(api, root, value, commandSessionID);
				}}
			/>
		));
	};

	// `api.command` is a deprecated v1 shim slated for removal; prefer the
	// keymap layer registration used by current opencode TUI feature plugins.
	if (typeof api.keymap?.registerLayer === "function") {
		api.keymap.registerLayer({
			commands: [
				{
					namespace: "palette",
					name: "goal",
					title: "Goal",
					desc: "Set or view the goal for a long-running task",
					category: "Goals",
					slashName: "goal",
					run() {
						openGoalDialog();
						return true;
					},
				},
				{
					namespace: "palette",
					name: "goal.edit",
					title: "Edit Goal",
					desc: "Edit the current session goal",
					category: "Goals",
					slashName: "goal-edit",
					slashAliases: ["goal edit"],
					run() {
						return runGoalCommand(api, root, "edit", activeSessionID);
					},
				},
				{
					namespace: "palette",
					name: "goal.pause",
					title: "Pause Goal",
					desc: "Pause the current session goal",
					category: "Goals",
					slashName: "goal-pause",
					slashAliases: ["goal pause"],
					run() {
						return runGoalCommand(api, root, "pause", activeSessionID);
					},
				},
				{
					namespace: "palette",
					name: "goal.resume",
					title: "Resume Goal",
					desc: "Resume the current session goal",
					category: "Goals",
					slashName: "goal-resume",
					slashAliases: ["goal resume"],
					run() {
						return runGoalCommand(api, root, "resume", activeSessionID);
					},
				},
				{
					namespace: "palette",
					name: "goal.clear",
					title: "Clear Goal",
					desc: "Clear the current session goal",
					category: "Goals",
					slashName: "goal-clear",
					slashAliases: ["goal clear"],
					run() {
						return runGoalCommand(api, root, "clear", activeSessionID);
					},
				},
			],
		});
	} else {
		api.command?.register(() => [
			{
				title: "Goal",
				value: "goal",
				description: "Set or view the goal for a long-running task",
				category: "Goals",
				slash: { name: "goal" },
				onSelect: openGoalDialog,
			},
		]);
	}

	api.slots.register({
		order: 50,
		slots: {
			session_prompt_right(_, props) {
				setActiveSession(props.session_id);
				return null;
			},
		},
	});

	api.event.on("tui.session.select", (event) => setActiveSession(event.properties.sessionID));
	api.event.on("session.created", (event) => setActiveSession(event.properties.sessionID));
	api.event.on("session.updated", (event) => setActiveSession(event.properties.sessionID));
	api.event.on("session.status", (event) => {
		setActiveSession(readSessionID(event.properties));
	});
}
