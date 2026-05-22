import { describe, expect, test } from "bun:test";
import { parseGoalCommand, parseTokenBudget, validateObjective } from "../command.js";

describe("goal command parsing", () => {
	test("parses control commands", () => {
		expect(parseGoalCommand("")).toEqual({ action: "show" });
		expect(parseGoalCommand("edit")).toEqual({ action: "edit" });
		expect(parseGoalCommand("pause")).toEqual({ action: "pause" });
		expect(parseGoalCommand("resume")).toEqual({ action: "resume" });
		expect(parseGoalCommand("clear")).toEqual({ action: "clear" });
	});

	test("keeps slash command text as objective text", () => {
		expect(parseTokenBudget("98.5K")).toBe(98500);
		expect(parseTokenBudget("2M")).toBe(2000000);
		expect(parseGoalCommand("--tokens 100K improve benchmark coverage")).toEqual({
			action: "set",
			objective: "--tokens 100K improve benchmark coverage",
		});
		expect(parseGoalCommand("improve benchmark coverage")).toEqual({ action: "set", objective: "improve benchmark coverage" });
	});

	test("validates objective boundaries", () => {
		expect(validateObjective("ship it")).toBeUndefined();
		expect(validateObjective("   ")).toBe("Goal objective cannot be empty.");
		expect(validateObjective("x".repeat(4001))).toBe("Goal objective cannot exceed 4000 characters.");
	});
});
