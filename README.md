# @op1/goals

Long-running goal support for OpenCode.

`@op1/goals` adds a Codex-style `/goal` workflow to OpenCode: set a durable objective for a session, expose goal state to the model through tools, account token/time usage, and continue active goals while the session is idle.

## Features

- `/goal` summary for the current session goal
- `/goal <objective>` to create or replace a goal
- `/goal-edit`, `/goal-pause`, `/goal-resume`, and `/goal-clear` direct control commands
- `get_goal`, `create_goal`, and `update_goal` model tools
- Project-local persistence in `.opencode/goals/<sessionID>.json`
- Token budget accounting from OpenCode step events (input + output + reasoning, cache excluded)
- Guarded continuation prompts that require evidence before marking a goal complete
- Codex-style states: `active`, `paused`, `blocked`, `usage_limited`, `budget_limited`, and `complete`

## Install

Register the npm plugin from `opencode.json` or `opencode.jsonc`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@op1/goals"]
}
```

OpenCode installs npm plugins automatically with Bun at startup. You do not need to add the plugin as a project dependency. For local development, you can also load a JavaScript or TypeScript plugin file under `.opencode/plugins/` or `~/.config/opencode/plugins/`.

## Usage

Set a goal:

```text
/goal finish the checkout refactor and verify the regression tests pass
```

Show the current goal:

```text
/goal
```

Edit or control it:

```text
/goal-edit
/goal-pause
/goal-resume
/goal-clear
```

Current OpenCode TUI plugin slash commands are dispatched without arguments, so `/goal clear` cannot be executed as a typed prompt. The direct commands above are registered for current OpenCode, and they also include autocomplete search aliases such as `goal clear`. The `/goal` dialog still accepts `edit`, `pause`, `resume`, and `clear` as input.

The model can also create a goal with an explicit token budget through `create_goal` when the user asks for one, and may replace the goal through `create_goal` once the previous goal is `complete`. The slash command keeps Codex parity and treats text such as `/goal --tokens 98.5K improve coverage` as objective text, not special syntax.

## Goal Lifecycle

Active goals are injected into the model context as untrusted user-provided objective data. When a turn finishes and the session becomes idle, the plugin can send a continuation prompt so work continues toward the same objective. If a token budget is reached, the goal is marked `budget_limited` and the next prompt asks the model to wrap up rather than start new substantive work. Raising the budget above current usage reverts a `budget_limited` goal to `active`.

Continuation is gated the same way Codex gates automatic idle turns: a user interrupt skips the next continuation, plan-mode sessions are not auto-continued, and terminal turn errors stop the goal (`usage_limited` for usage/rate-limit failures, `blocked` for other errors) so continuation cannot loop on a failing turn.

OpenCode's local continuation cap uses Codex's existing `paused` state so a capped goal is visible and can be resumed with `/goal-resume`. `/goal-resume` also reactivates `blocked` and `usage_limited` goals; a resumed `blocked` goal starts a fresh blocked audit.

The model can mark a goal `complete` through `update_goal` only after auditing that the objective is actually achieved, and may mark it `blocked` only after the same blocking condition has repeated for at least three consecutive goal turns. Pause, resume, budget-limited, and usage-limited status changes are controlled by the user or system.

## Development

OpenCode loads server plugins and TUI plugins through separate entries: the server side reads the `plugin` array in `opencode.json` (kind `server`, resolved through `exports["./server"]`), and the TUI reads the `plugin` array in `tui.json` (kind `tui`, resolved through `exports["./tui"]`). A plugin module must default-export `{ id, server }` or `{ id, tui }` — never both — which is why this package ships `dist/server.js` and `dist/tui.js` as separate entries.

### Local dev loop

This repo is self-hosting: `opencode.jsonc` and `tui.json` at the repo root register `dev/server.ts` and `dev/tui.tsx`, which load the plugin straight from TypeScript source. No build step is involved; Bun transpiles the server entry and the OpenCode TUI host applies the solid JSX transform at import time.

```sh
opencode .        # any session inside this repo loads the dev plugin
```

Restart opencode to pick up source changes (there is no plugin hot reload).

To test against a scratch project instead of this repo, launch the sandbox. It creates `.sandbox/` with project-local configs pointing back at the dev entries and starts opencode there, so the global `~/.config/opencode` configs stay untouched:

```sh
bun run dev            # create .sandbox/ and launch opencode in it
bun run dev --reset    # wipe sandbox state first
bun run dev --print    # only write the sandbox configs and print the path
```

Goal state for a session is stored under the project's `.opencode/goals/`, so sandbox runs keep their goal files inside `.sandbox/.opencode/goals/`.

To test the dev build in arbitrary projects, register the same dev entries globally with absolute `file://` URLs:

```jsonc
// ~/.config/opencode/opencode.json
{ "plugin": ["file:///absolute/path/to/goals/dev/server.ts"] }
```

```jsonc
// ~/.config/opencode/tui.json
{ "plugin": ["file:///absolute/path/to/goals/dev/tui.tsx"] }
```

This still loads from source (no stale builds), and it does not double-load inside this repo: OpenCode resolves path specs to absolute `file://` URLs against their declaring config file before merging and dedupes plugins by exact file URL, so the global entry and the repo-local `./dev/*` entries collapse into one. The only requirement is that `bun install` has been run in this repo, since the dev entries resolve `@opencode-ai/plugin` and `zod` from its `node_modules`.

### Tests

```sh
bun install
bun test          # store, command, server-hook, and entry-shape tests
bun run typecheck
bun run build
```

`src/__tests__/server.test.ts` drives the plugin hooks directly with a fake client: it simulates step/status/error events and asserts continuation prompts, abort suppression, plan-mode gating, turn-error handling, budget wrap-up, and dispose behavior. `src/__tests__/entries.test.ts` pins every entry module to OpenCode's `readV1Plugin` contract so the loader never falls back to the deprecated legacy path. `bunfig.toml` preloads the solid transform so tests can import `.tsx` modules.

## Publishing

The package is configured for public npm publishing. Set `NPM_TOKEN` in your shell or replace the placeholder in `.npmrc`, then run:

```sh
bun run build
npm publish --access public
```
