# @op1/goals

OpenCode plugin for long-running goals.

It ports Codex's experimental goal behavior into a Bun package with:

- `/goal`, `/goal pause`, `/goal resume`, and `/goal clear` in the TUI
- `get_goal`, `create_goal`, and `update_goal` model tools
- project-local state in `.opencode/goals/<sessionID>.json`
- guarded auto-continuation for active goals
- token budget accounting from OpenCode step events
