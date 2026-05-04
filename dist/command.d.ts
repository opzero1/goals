import type { ParsedGoalCommand } from "./types.js";
export declare function parseTokenBudget(value: string): number | undefined;
export declare function parseGoalCommand(input: string): ParsedGoalCommand;
export declare function validateObjective(objective: string): string | undefined;
