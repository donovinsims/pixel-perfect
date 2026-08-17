# Platform adapters

The repository checkout containing this skill is the canonical source. `install-global` detects installed agents and creates symlinks to that checkout. It never replaces a non-symlink target unless `--force` is supplied, and even then it moves the existing directory to a timestamped backup rather than deleting it. `sync-global` repairs missing or stale symlinks; `doctor` reports discoverability and runtime state.

Verified native `SKILL.md` locations on this machine: Claude Code `~/.claude/skills`, Codex `~/.codex/skills`, and OpenCode `~/.config/opencode/skills`. Cursor is installed only when the `cursor` executable and its global skills root can both be verified; otherwise it is reported as unavailable rather than guessed. All adapters expose one identical methodology.

Use capability detection: optional browser MCP augments Playwright, subagents/worktrees improve parallel construction only after frozen capture, and Dembrandt augments rather than replaces browser evidence.
