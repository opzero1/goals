/**
 * Launch an isolated opencode session wired to the plugin source in this
 * repo. Creates (or reuses) a sandbox project under .sandbox/ with its own
 * opencode.jsonc + tui.json pointing at dev/server.ts and dev/tui.tsx, then
 * starts opencode there.
 *
 * Why: testing the plugin against a scratch project without touching the
 * global ~/.config/opencode configs and without dirtying this repo's own
 * goal state. Global config (models, auth) still applies; only the plugin
 * registration is project-scoped.
 *
 * Usage:
 *   bun run dev                # create sandbox and launch opencode in it
 *   bun run dev --reset        # wipe sandbox state first
 *   bun run dev --print        # only print the sandbox path and configs
 */
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const sandbox = join(repo, ".sandbox");
const args = new Set(Bun.argv.slice(2));

if (args.has("--reset")) {
	await rm(sandbox, { recursive: true, force: true });
	console.log(`[dev] Reset ${sandbox}`);
}

await mkdir(sandbox, { recursive: true });

const opencodeConfig = {
	$schema: "https://opencode.ai/config.json",
	plugin: [join(repo, "dev", "server.ts")],
};
const tuiConfig = {
	$schema: "https://opencode.ai/tui.json",
	plugin: [join(repo, "dev", "tui.tsx")],
};

await Bun.write(join(sandbox, "opencode.jsonc"), `${JSON.stringify(opencodeConfig, null, 2)}\n`);
await Bun.write(join(sandbox, "tui.json"), `${JSON.stringify(tuiConfig, null, 2)}\n`);

console.log(`[dev] Sandbox project: ${sandbox}`);
console.log("[dev] Plugin loads from source; restart opencode to pick up changes.");

if (args.has("--print")) process.exit(0);

const child = Bun.spawn(["opencode"], {
	cwd: sandbox,
	stdio: ["inherit", "inherit", "inherit"],
});
process.exit(await child.exited);
