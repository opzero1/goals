import type { PluginModule } from "@opencode-ai/plugin";
import { GoalsServerPlugin } from "./server.js";

/**
 * Server plugin entry. OpenCode resolves this module for the `server` plugin
 * kind via the package.json `exports["./server"]` subpath and expects a
 * default export shaped `{ id?, server }` (PluginModule).
 */
const module = {
	id: "@op1/goals",
	server: GoalsServerPlugin(),
} satisfies PluginModule;

export default module;
