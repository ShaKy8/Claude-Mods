# ship

Git state in the status line, and `/ship` to stage, commit and push in one step.

```
/plugin install ship --marketplace ShaKy8/Claude-Mods
```

## Status line

Refreshed at session start, after every turn, and after any Bash call that mentions `git`:

| Shown | Meaning |
| --- | --- |
| `⎇ main ✓` | clean, in sync with upstream |
| `⎇ main ●3` | 3 changed or untracked files |
| `↑2` / `↓1` | 2 commits to push / 1 to pull |
| `no upstream` | branch has no upstream yet |

Nothing is shown outside a git repository. For prompt-cache numbers use a separate mod; `ship` no longer reports them.

## `/ship [message]`

1. Nothing changed and nothing to push: does nothing.
2. Refuses on a detached HEAD, and refuses (staging nothing) if a changed file looks like a secret: `.env*`, `*.pem`, `*.key`, `id_rsa`, `credentials`, and similar.
3. `git add -A`, then `git commit -m <message>`. With no message it writes `Update a.ts, b.ts and N more`.
4. `git push`, or `git push -u origin <branch>` when there is no upstream. It never forces.

Git runs with repo hooks off here (an engine rule for `$.process.run`), so pre-commit hooks do not run under `/ship`.

## Develop

```
claude plugin validate .
claude plugin test .
```
