import type { ParsedGoalCommand } from "./types.js";

export function parseTokenBudget(value: string): number | undefined {
	const match = value.trim().match(/^(\d+(?:\.\d+)?)([kKmM])?$/);
	if (!match) return undefined;
	const amount = Number(match[1]);
	if (!Number.isFinite(amount) || amount <= 0) return undefined;
	const multiplier = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2]?.toLowerCase() === "k" ? 1_000 : 1;
	return Math.floor(amount * multiplier);
}

export function parseGoalCommand(input: string): ParsedGoalCommand {
	const trimmed = input.trim();
	if (!trimmed) return { action: "show" };
	const command = trimmed.toLowerCase();
	if (command === "clear") return { action: "clear" };
	if (command === "edit") return { action: "edit" };
	if (command === "pause") return { action: "pause" };
	if (command === "resume") return { action: "resume" };
	return { action: "set", objective: trimmed };
}

export function validateObjective(objective: string): string | undefined {
	const trimmed = objective.trim();
	if (!trimmed) return "Goal objective cannot be empty.";
	if (trimmed.length > 4000) return "Goal objective cannot exceed 4000 characters.";
	return undefined;
}
