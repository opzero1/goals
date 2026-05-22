import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { Accessor } from "solid-js";
import { createSignal, Show } from "solid-js";
import { parseGoalCommand, validateObjective } from "./command.js";
import { formatGoalStatus, formatGoalSummary } from "./prompts.js";
import { createGoal, deleteGoal, readGoal, replaceGoal, updateGoalObjective, updateGoalStatus } from "./store.js";
import type { GoalState } from "./types.js";

function getSessionID(api: TuiPluginApi): string | undefined {
	const sessionID = api.route.current.name === "session" ? api.route.current.params?.sessionID : undefined;
	return typeof sessionID === "string" ? sessionID : undefined;
}

async function showGoal(api: TuiPluginApi, root: string, sessionID: string) {
	const goal = await readGoal(root, sessionID);
	api.ui.toast({ message: goal ? formatGoalSummary(goal) : "No goal is currently set. Usage: /goal <objective>", variant: "info" });
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
			onConfirm={async (value) => {
				api.ui.dialog.clear();
				const error = validateObjective(value);
				if (error) {
					api.ui.toast({ message: error, variant: "error" });
					return;
				}
				await updateGoalObjective(root, {
					sessionID,
					objective: value,
					status: goal.status === "budget_limited" || goal.status === "complete" ? "active" : goal.status,
					tokenBudget: goal.tokenBudget,
				});
				api.ui.toast({ message: "Goal updated", variant: "success" });
			}}
		/>
	));
}

async function runGoalCommand(api: TuiPluginApi, root: string, args: string) {
	const sessionID = getSessionID(api);
	if (!sessionID) {
		api.ui.toast({ message: "Start or select a session before using /goal.", variant: "error" });
		return;
	}
	const command = parseGoalCommand(args);
	if (command.action === "show") return showGoal(api, root, sessionID);
	if (command.action === "edit") return editGoal(api, root, sessionID);
	if (command.action === "set") return setGoal(api, root, sessionID, command.objective ?? "", command.tokenBudget);
	if (command.action === "pause") {
		const goal = await updateGoalStatus(root, sessionID, "paused");
		if (!goal) {
			api.ui.toast({ message: "No goal to pause", variant: "info" });
			return;
		}
		api.ui.toast({ message: "Goal paused", variant: "info" });
		return;
	}
	if (command.action === "resume") {
		const goal = await updateGoalStatus(root, sessionID, "active");
		if (!goal) {
			api.ui.toast({ message: "No goal to resume", variant: "info" });
			return;
		}
		api.ui.toast({ message: "Goal resumed", variant: "success" });
		return;
	}
	if (await deleteGoal(root, sessionID)) api.ui.toast({ message: "Goal cleared", variant: "info" });
	else api.ui.toast({ message: "No goal to clear", variant: "info" });
}

function GoalPromptStatus(props: { goal: Accessor<GoalState | undefined>; api: TuiPluginApi }) {
	const goal = props.goal();
	return (
		<Show when={goal}>
			<text fg={props.api.theme.current.textMuted}>{goal ? formatGoalStatus(goal) : ""}</text>
		</Show>
	);
}

export async function installGoalsPlugin(api: TuiPluginApi): Promise<void> {
	const root = api.state.path.directory || process.cwd();
	const [goal, setGoalState] = createSignal<GoalState | undefined>();
	const refresh = async (sessionID?: string) => setGoalState(sessionID ? await readGoal(root, sessionID) : undefined);

	api.command.register(() => [
		{
			title: "Goal",
			value: "goal",
			description: "Set or view the goal for a long-running task",
			category: "Goals",
			slash: { name: "goal" },
			onSelect: () => {
				api.ui.dialog.replace(() => (
					<api.ui.DialogPrompt
						title="Goal"
						placeholder="improve benchmark coverage"
						onConfirm={async (value) => {
							api.ui.dialog.clear();
							await runGoalCommand(api, root, value);
							await refresh(getSessionID(api));
						}}
					/>
				));
			},
		},
	]);

	api.slots.register({
		order: 50,
		slots: {
			session_prompt_right(_, props) {
				void refresh(props.session_id);
				return <GoalPromptStatus api={api} goal={goal} />;
			},
		},
	});

	api.event.on("session.status", (event) => {
		const sessionID = (event.properties as { sessionID?: string; sessionId?: string }).sessionID ?? (event.properties as { sessionId?: string }).sessionId;
		void refresh(sessionID);
	});
}
