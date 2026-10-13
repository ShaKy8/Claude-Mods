# cache-control

A Claude Code mod that shows prompt-cache stats in the status line after each model step:

```
cache 80% hit · 800 read · 100 written
```

- **hit** is cache-read input tokens divided by all input tokens (uncached + read + written) for that step.
- **read** is the input tokens the prompt cache served.
- **written** is the input tokens the step wrote to the cache.

If a step reports no usage, the status line is left alone.

## Install

From the marketplace in this repository, typed at the prompt of a Claude Code session:

```
/plugin install cache-control --marketplace ShaKy8/Claude-Mods
```

Answer `y` to add the marketplace, then pick a scope.

To run it from a local checkout without installing, start Claude Code with the mod's folder loaded:

```sh
claude --plugin-dir ~/Projects/Claude-Mods/cache-control
```

Or, where no flag can be given, name the folder in `CLAUDE_CODE_PLUGIN_DIRS`: absolute paths (`~` allowed), separated by `:`, set in the environment or in the `env` block of `~/.claude/settings.json`.

```sh
CLAUDE_CODE_PLUGIN_DIRS=~/Projects/Claude-Mods/cache-control claude
```

Either way the mod is loaded for that session only; `claude plugin list` shows it as `cache-control@inline`.

## Develop

```sh
claude plugin validate .
claude plugin test .
```

`tsc -p .` type-checks the mod once the engine has written `.claude-plugin/types/` (it is git-ignored and regenerated when the mod loads).
