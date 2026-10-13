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

Start Claude Code with the mod's folder loaded:

```sh
claude --plugin-dir ~/Projects/Claude-Mods/cache-control
```

To load it in every session, set `CLAUDE_CODE_PLUGIN_DIRS` to the folder instead.

## Develop

```sh
claude plugin validate .
claude plugin test .
```

`tsc -p .` type-checks the mod once the engine has written `.claude-plugin/types/` (it is git-ignored and regenerated when the mod loads).
