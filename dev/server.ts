import type { PluginModule } from "@opencode-ai/plugin";
import { GoalsServerPlugin } from "../src/server.js";

/**
 * Development server entry, loaded straight from TypeScript source by the
 * repo-local opencode.jsonc. No build step: Bun transpiles on import, so a
 * restart of opencode picks up source changes.
 */
const module = {
	id: "@op1/goals-dev",
	server: GoalsServerPlugin(),
} satisfies PluginModule;

export default module;
