# @op1/goals

Long-running goal support for OpenCode.

`@op1/goals` adds a Codex-style `/goal` workflow to OpenCode: set a durable objective for a session, expose goal state to the model through tools, account token/time usage, and continue active goals while the session is idle.

## Features

- `/goal` summary for the current session goal
- `/goal <objective>` to create or replace a goal
- `/goal edit`, `/goal pause`, `/goal resume`, and `/goal clear`
- `get_goal`, `create_goal`, and `update_goal` model tools
- Project-local persistence in `.opencode/goals/<sessionID>.json`
- Token budget accounting from OpenCode step events
- Guarded continuation prompts that require evidence before marking a goal complete

## Install

```sh
bun add @op1/goals
```

Register the plugin from your OpenCode config:

```ts
import GoalsPlugin from "@op1/goals";

export default [GoalsPlugin];
```

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
/goal edit
/goal pause
/goal resume
/goal clear
```

The model can also create a goal with an explicit token budget through `create_goal` when the user asks for one. The slash command keeps Codex parity and treats text such as `/goal --tokens 98.5K improve coverage` as objective text, not special syntax.

## Goal Lifecycle

Active goals are injected into the model context as untrusted user-provided objective data. When a turn finishes and the session becomes idle, the plugin can send a continuation prompt so work continues toward the same objective. If a token budget is reached, the goal is marked `budget_limited` and the next prompt asks the model to wrap up rather than start new substantive work.

The model can only mark a goal `complete` through `update_goal` after auditing that the objective is actually achieved.

## Development

```sh
bun install
bun test
bun run typecheck
bun run build
```

## Publishing

The package is configured for public npm publishing. Set `NPM_TOKEN` in your shell or replace the placeholder in `.npmrc`, then run:

```sh
bun run build
npm publish --access public
```
