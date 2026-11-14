# Claude-Mods

Working instructions for any model in this repository. Every claim here was checked against the code, the git history or a run of the command. If this file and the code disagree, the code is right: fix this file in the same change.

## Read this first

Four facts account for most of the damage a newcomer can do here.

1. **These mods wrap irreversible actions. Never exercise them for real.** `/ship` commits and pushes. `boot-guard` snapshots the root filesystem and gates commands that change what boots. Prove behaviour in the test kit, which fakes git and snapper. Do not run `/ship`, `git push`, `snapper create`, `dkms`, `mkinitcpio`, `limine-*`, `modprobe` or `claude -p "/ship"` to see whether something works.
2. **The published copies may be running in your own session.** `claude plugin list` shows them as `ship@claude-mods` and `boot-guard@claude-mods`. Unless an entry has a `Read from:` line naming this folder, the session runs the copy installed from GitHub, and your edits here do not change what it does. An installed `boot-guard` also reads every Bash command you run, and it matches text. Up to 0.1.0 it matched any writer word and protected path anywhere in a command, so a commit message that says `also catch cp into /boot`, or an `echo "sed -i ... /boot/limine.conf" > notes.txt`, takes a real snapshot or is refused; `claude plugin list` shows which version is installed. Create files with your file tools instead of shell redirects, and keep such strings out of shell commands. If a command is refused, do not reword it to get past the guard: stop and say so.
3. **The mod API is early access and changes between Claude Code releases. Look it up; do not recall it.** What you remember as "Claude Code hooks" is probably the settings hooks (`PreToolUse` shell commands in `settings.json`), a different mechanism. The authority is the declaration file the engine writes, `<plugin>/.claude-plugin/types/claude-code/index.d.ts`. It is far too long to read whole: search it for the name at hand (`'tool.call'`, `export type CommandRunInput`, `ProcessRunResult`). If your harness has a `plugin-authoring` skill, load it before editing a hooks module, but ignore its instruction to write mods under `~/.claude/dev-mods/` and its offer to create a repository: here a mod is edited in place, and this repository already is the marketplace.
4. **Pushing `master` is publishing.** The marketplace is this repository, `ShaKy8/Claude-Mods`. There is no CI and no release step: `origin/master` is what everyone who installed a mod gets at their next update. Commit or push only when asked.

## What this project is

A Claude Code plugin marketplace, `claude-mods`, holding the author's mods. A mod is a plugin that changes Claude Code's own behaviour through function hooks: code the engine runs at its own events (a tool call, a slash command, the end of a turn). People install one with `/plugin install <plugin> --marketplace ShaKy8/Claude-Mods`.

| Plugin | Job |
| --- | --- |
| `ship` | Git state in the status line (`⎇ main ●3 ↑2`), and `/ship [message]` to stage, commit and push in one step. |
| `boot-guard` | Takes a `snapper` snapshot before any Bash command that can change what boots, and refuses the command when the snapshot cannot be taken. `/guard-ack` lets such commands through for ten minutes. |

`boot-guard` is written for an Arch-based system: `pacman`/`yay`/`paru`, `mkinitcpio`, `limine`, `dkms`, and the snapper config named `root`.

## How it's built

There is no build step and there are no dependencies: no `package.json`, bundler, linter, formatter or CI. The engine loads each plugin's TypeScript as it stands.

**A mod is one hooks module.** `hooks/hooks.json` names it (`{ "modules": ["./register.ts"] }`), and it exports `register`:

```ts
import type { Register } from 'claude-code'

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isRisky(e.command)) return next(e)
    return { deny: 'my-mod: what was refused, and what to do next' }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'my-mod: its check failed' }))
}
```

- `on(event, matcher?, hook)` adds a hook, and every hook is `($, e, next)`.
- `$` is the engine, spelled noun then method: `$.process.run`, `$.ui.status`, `$.ui.toast`, `$.command.register`, `$.clock.now`.
- `e` is the event's input, a frozen plain value.
- `next(e)` runs the plugins beneath, then the engine's own behaviour, and resolves to the event's result. A hook that returns without calling `next` answers for itself: `{ deny }` on a tool call, `{ text }` for its own command. `next({ ...e, x })` rewrites what the rest sees.
- A hook that throws, overruns its time budget, or returns nothing or the wrong shape is skipped, and the chain goes on as if it were not there. Only a `.catch` on the registration can answer in its place.
- The module runs in an environment of its own: no Node, no DOM, no `require`, no `import()`. Everything outside the module is reached through `$`, and the `'claude-code'` import is types only. `console` and `setTimeout` are not in the declarations, so `tsc` rejects them: log with `$.ui.log(text, { to: 'debug' })` and keep time with `$.clock`.

**`ship/hooks/register.ts`.** `inspect(run)` parses `git status --porcelain=v2 --branch --untracked-files=all` into a `Repo` (`branch`, `upstream`, `ahead`, `behind`, `changed`). `summarize` turns it into the status line, `ship(run, message)` is the `/ship` flow, and `refresh($)` pins the status line. Hooks: `session.start` registers `/ship`; `turn.complete` and any Bash `tool.call` that mentions `git` refresh after `next`; `command.run` on `ship` answers the command.

**`boot-guard/hooks/register.ts`.** `lex(command)` reads the command as the shell would: it honours quotes and backslashes, splits on unquoted `&&`, `||`, `;`, `|`, `&` and new lines, skips heredoc bodies, and returns each segment's words apart from its redirect targets. `classify` looks inside `sh -c '...'` and `$(...)` and returns the reason a segment is risky, or `null`. `classifyTokens` skips wrappers (`sudo`, `env`, `nice`, ...) and their options, `WRAPPER_VALUES` naming the options that take a value (`sudo -u root`), and matches the command name against the rule tables at the top of the file. A segment is `boot config` when it redirects into a protected path (`/boot`, `/etc/modprobe.d`, ...), or when its command writes (`WRITERS`, `sed -i`, `find -delete` or `-exec`) and an argument is a protected path. Text inside a quoted argument is never a command, which is what keeps a commit message or a `grep` pattern from counting. The Bash `tool.call` hook classifies, lets acknowledged commands through, takes the snapshot, then either denies (no snapshot) or shows a toast, pins the undo command in the status line and calls `next`.

**Types.** When the engine loads a plugin from a folder it hot-reloads (`claude --plugin-dir <plugin>` in an interactive session), it writes that build's declarations into `<plugin>/.claude-plugin/types/`. The plugin's `tsconfig.json` extends the `tsconfig.json` in there (`strict`, `noUncheckedIndexedAccess`, `noEmit`). Git ignores the folder, so a fresh clone or a new worktree has none. The first line of `claude-code/index.d.ts` names the Claude Code version that wrote it.

**Tests.** `claude plugin test <plugin>` runs every `*.test.ts` and `*.test.tsx` under the folder against the engine itself, in an environment with no filesystem, network or processes. A test is `test(name, async ($, on) => { ... })`: `$` is the engine with the plugin loaded, and the hooks the test registers with `on` sit beneath every plugin and stand in for the world (git, snapper, the tool that would have run).

## Map of the folders

```
.claude-plugin/marketplace.json   the marketplace: name, owner, one entry per plugin (name, source, description)
README.md                         plugin table, install line, how to validate and test
CLAUDE.md                         this file
test.sh                           runs `claude plugin test .` inside each plugin folder named in its loop
LICENSE                           MIT
.gitignore                        ignores */.claude-plugin/types/ and .claude/
ship/
  .claude-plugin/plugin.json      name, version, description, author
  .claude-plugin/types/           written by the engine, ignored by git: never edit, commit or delete
  hooks/hooks.json                { "modules": ["./register.ts"] }
  hooks/register.ts               the whole mod
  hooks/ship.test.ts              its tests
  tsconfig.json                   extends ./.claude-plugin/types/tsconfig.json
  README.md                       what the mod does, for the person who installs it
boot-guard/                       the same layout; its tests are hooks/boot-guard.test.ts
.claude/skills/prompt-cache-control/   not part of this project (below)
```

`.claude/skills/prompt-cache-control/` is someone else's mod (from `claude-code-templates`), installed in this working copy only. Git ignores it, sessions started here load it as `prompt-cache-control@skills-dir`, and it is not in the marketplace. Leave it alone unless asked, and do not copy its conventions. It is a fair example of a mod that draws: a band and a pane through `ui.render`, and a streaming `turn.step` hook.

The tag `v0.1.1` keeps the removed `cache-control` mod. Tags are otherwise unused.

## Commands

Run from the repository root.

| To | Run |
| --- | --- |
| Build | nothing: the engine loads the `.ts` files as they stand |
| Test every plugin | `./test.sh` |
| Test one plugin | `claude plugin test ship` |
| Validate the marketplace manifest | `claude plugin validate .` |
| Validate one plugin | `claude plugin validate ship` |
| Type-check one plugin | `npx --yes -p typescript tsc --noEmit -p ship` |
| Try a plugin live (a person does this, in a terminal) | `claude --plugin-dir ship` |
| See why a hook was skipped | `claude --debug --plugin-dir ship` |

- `claude plugin test .` at the root fails with `no hooks module to load`: the root is a marketplace, not a plugin. There is no filter for a single test or file; each suite takes a second or two.
- `claude plugin validate <plugin>` prints what the engine sees. Read two lines of it: `calls:` lists the `$` methods the module uses, and each guard must appear under `gating hook with .catch:`, never `without`. Its `ICON_MISSING` warning is expected and fails nothing.
- `claude plugin test` does not type-check: a test with type errors passes. Only `tsc` finds them. `tsc` prints nothing when the types are right, and `npx` downloads TypeScript the first time.
- Keep `--noEmit` on the command line. The `noEmit` setting lives in the engine-written `tsconfig.json`, so without the flag a missing types folder makes `tsc` write `register.js` and `<plugin>.test.js` into `hooks/`.
- `tsc` needs `<plugin>/.claude-plugin/types/`. If it reports `TS5083: Cannot read file '.../.claude-plugin/types/tsconfig.json'`, the folder is missing: ask the person to run `claude --plugin-dir ship --plugin-dir boot-guard` once, which writes it, and report that type-checking was not done. If the first line of `claude-code/index.d.ts` names an older version than `claude --version`, the declarations are stale: `tsc` still runs, but for an API question trust the current build (what `claude plugin validate` reports, or the declarations the `plugin-authoring` skill writes).

## How to work on a task

1. Read the plugin's `register.ts`, its test file and its README in full before changing anything. Each is under 150 lines.
2. Look up every event and `$` method you are about to use in the declarations.
3. Add the test for the new behaviour first and watch it fail for the right reason. Then change the module.
4. Make the smallest change that does the job, and change the module, its test, its README and the manifests in the same pass.
5. Run the checklist at the end of this file and report what you ran.
6. When the request leaves open something a person will see or cannot undo (a command's name, what counts as risky, anything that pushes), ask. Otherwise take the conservative option and say which you took.

## Coding rules

The two existing modules are the style guide. Match them.

**Layout**
- One plugin, one folder, one module: `hooks/register.ts`, with its tests beside it as `hooks/<plugin>.test.ts`. Do not split a module this size into files.
- Order inside the module: type imports, constants and rule tables, pure functions, the few functions that take `$`, and `register` last.

**Style**
- TypeScript under `strict` and `noUncheckedIndexedAccess`. No semicolons, single quotes, two-space indent, trailing commas in multi-line lists.
- No comments in the modules. Names and small functions carry the meaning, and behaviour is explained in the plugin's README. Add a comment only for a constraint the code cannot show.
- Constants are `SCREAMING_SNAKE_CASE` at the top: a `Set` for a list of words, a `RegExp` for a pattern. A new rule is a new entry in a table before it is a new branch.
- Indexed access can be `undefined`. Use `!` only where the line above proves the value is there (`tokens[i]!` inside `while (i < tokens.length)`); otherwise `?.` or `??`.
- No `any` in a module. Test helpers take `on: any` and `$: any`, the one accepted use.

**Engine calls**
- Keep the logic pure and pass `$` in at the edge. `classify` takes a string. `inspect` and `ship` take a `Run` function, and the hook supplies `argv => $.process.run(argv)`. Only `register`, `refresh` and `snapshot` touch `$`.
- `$.process.run` takes an argument vector and runs no shell. One element per argument, and text from a person (a commit message, a description) is an element of its own: `['git', 'commit', '-m', msg]`. Never build a command string, never `['sh', '-c', ...]`.
- `$.process.run` resolves for any exit code. It rejects only when the command cannot start or outlives its timeout (30 seconds unless `timeoutMs` says otherwise). So check `exitCode` every time, and wrap the call in `try` wherever a rejection must not escape (`snapshot` returns `{ error }`, `refresh` clears the status line).
- Git runs with repository hooks off under `$.process.run`, so `/ship` cannot lean on a pre-commit hook. That is why its secrets check lives in the module.
- Report failure as a value, not a throw: `{ error }`, or `fail(text)`, which gives `{ text, exitCode: 1 }`. A throw inside a hook gets the hook skipped.
- Read time from `$.clock.now()`, never `Date.now()`, and wait with `$.clock`, never `setTimeout`. Tests move time with `mock.clock`.
- Register a slash command in `session.start`, then `return next(e)`. Answer it in `on('command.run', { command: '<name>' }, ...)` by returning `{ text }`. `session.start` is awaited before the first prompt, so slow work there is started and not awaited: `void refresh($)`.
- A hook that only watches calls `next` first and returns its result unchanged: `const ran = await next(e); ...; return ran`. A hook that guards decides before it calls `next`.
- Every `tool.call` hook carries a `.catch`, and the `.catch` states the policy. A watcher fails open: `.catch(($, e, next) => next(e))`. A guard fails closed: `next.called ? next(e) : { deny: '...' }`.
- Module-level `let` starts over at every reload and every session. Keep there only state that is safe to lose: `ackedUntil` falling back to `0` means "not acknowledged".

**Words shown to people**
- Command output, deny reasons and toasts start with the plugin's name and a colon: `ship: nothing to ship.`, `boot-guard: snapshot #42 before limine`.
- A deny reason is read by the model that made the call. Say what was refused, that nothing ran, and exactly what to tell the person to do next, with the command to type.
- Plain sentences. No emoji, no exclamation marks. The status line uses a small fixed set of glyphs: `⎇ ● ↑ ↓ ✓`.

**Tests**
- Import `test`, `expect` and `mock` from `'claude-code/testing'`. Register every fake with `on` before the first call on `$`: that call loads the plugin.
- Fake the world; never touch it. A fake for a call on `$` returns `{ value }`: `on('process.run', async (_$, e) => ({ value: ok() }))`. A fake for the tool that would have run returns `{ result: { stdout, stderr, interrupted } }`. Give a fake the engine's whole result shape, `isStdoutTruncated` and `isStderrTruncated` included. A fake answers; it does not throw.
- Assert on the argument vectors the plugin ran and on the text it returned, and assert what must not have happened: `add` never ran, the tool never ran.
- `$.command.run` takes the whole `CommandRunInput`: `command`, `args`, `origin: { kind: 'composer' }`, `presentation: { isFullscreen: false, columns: 80 }`.
- Name a test as the behaviour, in a sentence: `'/ship refuses likely secrets and stages nothing'`.
- `boot-guard`'s tests are two tables, `RISKY` and `SAFE`. Every change to a rule adds the command it must catch to `RISKY` and the nearest look-alike it must leave alone to `SAFE`.

**Docs and manifests**
- A plugin's README: the name, one sentence, the install line, the behaviour (a table for a list of cases), its limits if it has any, and `## Develop` with the validate and test commands. No badges, no changelog.
- A plugin's `description` is written in three places: word for word in its `plugin.json` and its `marketplace.json` entry, and in a shorter form in the root README's table.
- `version` lives only in `plugin.json`. Bump it when the plugin's behaviour changes: so far the middle number for behaviour added or removed, the last for anything smaller.

**Git**
- Commit or push only when asked. Stage files by path, one logical change per commit. Commits so far went straight to `master`.
- The subject is imperative, capitalised, without a full stop, and names the plugin when that helps: `Add boot-guard mod: snapper snapshot before boot-affecting Bash commands`. Add a body only for the why, or for where a removed thing now lives.

## Design rules

- **One mod, one job.** A new job is a new plugin folder, not a feature added to an existing mod. The history is the lesson: a cache meter was merged into `ship` and taken out again, and `ship`'s last test pins that it ignores cache usage. Do not put it back.
- **Say which way it fails.** A mod that protects something fails closed: when `boot-guard` cannot take a snapshot, or its own check breaks, the command does not run. A mod that only informs fails open: when `ship` cannot read git, the status line goes blank and the tool call is untouched. Either way, a mod never breaks a command it had no reason to touch: `boot-guard` refuses only what it classified as risky.
- **Check first, act second, and never do the irreversible thing unasked.** `/ship` refuses on a detached HEAD, and on anything that looks like a secret, before it stages a single file, and it never force-pushes. `boot-guard` takes the snapshot before the command, not after.
- **Leave reads alone.** A guard that fires on `ls /boot` or `pacman -Q` gets switched off. A false alarm costs a snapshot or a refusal, so precision counts as much as coverage.
- **A refusal carries the way forward.** What happened, that nothing ran, and the one or two commands that fix it.
- **Stay quiet.** One status-line entry per plugin: the engine keeps one, a new `$.ui.status` replaces it, and `undefined` removes it, which is what `ship` does outside a git repository. A toast only when something was done. No output for a command that was left alone.
- **An override expires by itself.** `/guard-ack` lasts ten minutes and lives in memory, so a reload ends it early, which is the safe direction.
- **Be honest about limits.** `boot-guard` matches command text and sees only Claude's Bash tool, and its README says so under Limits. A change that adds a limit adds it there.
- **Installable as it stands.** A plugin is installed straight from its folder, so it needs nothing outside it: no dependencies, no generated files, no build output, no code shared with another plugin.
- **A mod that draws** (a pane, a band above the prompt) is not in this repository yet. If one is asked for: elements come from `$.ui.resolve(e)`, state a drawing reads lives in `$.state` under a contract in `types/index.d.ts`, the tree is sized to `e.props.bodyColumns`, and its tests mount it on each surface it claims to support.

## Mistakes to expect here, and how to avoid each

1. **Treating this as a Node project.** Looking for `package.json`, running `npm install` or `npm test`, adding a test runner, linter, formatter, bundler or CI file, importing a package or `fs`. *Instead:* nothing is installed and nothing is added. A module reaches the outside through `$`; tests run with `claude plugin test`.
2. **Writing settings hooks, or API from memory.** *Instead:* `hooks/hooks.json` here is `{ "modules": ["./register.ts"] }`, not a `PreToolUse` table. Search the declarations for every event and `$` method before using it, then read what `claude plugin validate <plugin>` says the module hooks and calls.
3. **Testing by doing.** Running `/ship`, a real push, real `snapper`, or a boot-affecting command to watch the mod react. *Instead:* the test kit is the only place those ever run, against fakes.
4. **Tripping the installed guard, or expecting edits to be live.** Under an installed `boot-guard` 0.1.0, a fixture written with `echo ... >` or a heredoc, a commit message quoting a rule, or a `grep` for a writer word in a protected file can each take a real snapshot. And the session keeps running the installed copy, not your edit. *Instead:* file tools for files, plain wording in shell commands, tests as the proof.
5. **A guard with no `.catch`.** A guard that throws is skipped and the tool runs: it has failed open and told no one. *Instead:* `.catch(($, e, next) => (next.called ? next(e) : { deny }))`, the judgement made before `next`, and the `gating hook with .catch:` line confirmed in validate.
6. **Widening a rule without its look-alike.** A broader pattern starts firing on reads, or on `git commit -m "update dkms notes"`. *Instead:* each `RISKY` case comes with the nearest command for `SAFE`, and the whole suite is run.
7. **Misusing `$.process.run`.** Passing a command string, wrapping in `sh -c`, treating a non-zero exit as an exception, or letting a rejection escape a hook. *Instead:* an argument vector, `exitCode` checked, `try` where it must not throw.
8. **`Date.now()` or `setTimeout`.** `tsc` rejects `setTimeout`, and the test clock cannot move `Date.now()`, so an expiry cannot be tested. *Instead:* `$.clock`.
9. **A path through a hook that returns nothing.** The engine skips the hook with `returned no result`, after its side effects have already run. *Instead:* every path returns `next(e)`, its awaited result, or a deliberate answer.
10. **Taking a green test run for a type check, or type-checking carelessly.** A `$.command.run` call missing `origin` and `presentation` passes its test and fails `tsc`. And a bare `tsc -p <plugin>` in a clone with no types folder writes `.js` files beside the sources. *Instead:* run both checks, `tsc` always with `--noEmit`.
11. **Tests that reach the real world, or fakes registered late.** No temporary repositories, no real git, no real snapper. *Instead:* fakes registered before the first call on `$`. A failure reading `no implementation for <event>` means nothing beneath the plugin answered that call: add a fake for it. The plugin is not broken.
12. **Editing, committing or deleting `.claude-plugin/types/`.** *Instead:* fix the code, not the declarations. The engine writes that folder, git ignores it, and `tsconfig.json` needs it.
13. **`git add -A` or `git add .`.** It once committed `.claude/skills/prompt-cache-control` by accident (`4e73038`, undone in `546593d`). *Instead:* stage by path after reading `git status`.
14. **Changing one copy of a fact.** A description, a version, a plugin's name or a behaviour is written in several files. *Instead:* item 5 of the checklist below.
15. **Sharing code between plugins.** An import from `../shared/` does not exist for the person who installs one plugin. *Instead:* repeat the few lines.
16. **Doing more than was asked.** Comments added to the modules, reformatting, a refactor of the other plugin, an option "for flexibility", a feature folded into the wrong mod. *Instead:* the smallest change, and a new plugin for a new job.
17. **Running `claude plugin test .` at the root** and reading the error as a broken project. *Instead:* `./test.sh`, or name the plugin.
18. **Reporting more than was verified.** Passing tests show the hooks behave against fakes. They do not show the mod working in a live session; only a person running `claude --plugin-dir <plugin>` sees that. *Instead:* say which of the two you have.

## Before you call a task done

Run these in order, and read the output, not only the exit code.

1. `./test.sh` passes, and new behaviour has a test: the count of passing tests went up, and a `boot-guard` rule has both a `RISKY` and a `SAFE` case.
2. `claude plugin validate <plugin>` passes for each plugin you touched, `calls:` lists what you expect, and every guard is under `gating hook with .catch:`.
3. `claude plugin validate .` passes, if you touched `marketplace.json` or added a plugin.
4. `npx --yes -p typescript tsc --noEmit -p <plugin>` prints nothing for each plugin you touched. If the types folder is missing, say that this check was not run.
5. Every copy of a fact agrees:
   - a description: `plugin.json`, the `marketplace.json` entry (word for word), the root README's table (short form)
   - a behaviour: the plugin's README, including its tables and its Limits
   - a version: bumped in `plugin.json` when behaviour changed
   - a new plugin: its folder, its `marketplace.json` entry, its row in the root README, its name in the loop in `test.sh`
6. `git status` shows only the files you meant to change: nothing under `.claude/` or `.claude-plugin/types/`, no scratch files, and no `.js` files in `hooks/`.
7. Nothing was committed or pushed unless that was asked for.
8. Your report says what changed, which of these checks you ran with their results, and what you could not verify.
