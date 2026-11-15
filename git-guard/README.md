# git-guard

Saves a `git bundle` of the repository before any Bash command that rewrites or deletes git history: force pushes, `filter-repo`, `reset --hard`, and branch and tag deletes. If the bundle can't be saved, the command is refused and does not run.

```
/plugin install git-guard --marketplace ShaKy8/Claude-Mods
```

## What counts as risky

| Reason | Examples |
| --- | --- |
| `force push` | `git push` with `-f`, `--force`, `--force-with-lease`, `--mirror`, or a `+refspec` (not `--dry-run` or `-n`) |
| `remote delete` | `git push --delete`, `-d`, `--prune`, or a `:branch` refspec |
| `history rewrite` | `git filter-repo` (not `--analyze` or `--version`), `git filter-branch` |
| `reset hard` | `git reset --hard` (not `--soft`, `--mixed` or `git reset <file>`) |
| `branch delete` | `git branch -D`, `--delete --force`, `-d -f` (not a plain `-d`, which git already refuses for unmerged work) |
| `tag delete`, `tag overwrite` | `git tag -d`, `git tag -f` |
| `ref delete` | `git update-ref -d` |

Text that only mentions a command is left alone: a `git commit -m` message, a `grep` pattern, an `echo`'d string, or the body of a heredoc. It reads quotes the way the shell does, and looks inside `sh -c '...'` and `$(...)`, across `&&`, `;`, pipes and new lines, inside `if`, `for`, `while` and `{ ...; }`, and past `env`, `nice`, `timeout` and `sudo`.

## Which repository

The one the git command runs in: `git -C <dir>`, else the folder the command has moved to by then (`cd`, `pushd` and `popd`, undone when a `( ... )` subshell closes), else the folder Claude's shell is in. When that can't be read from the text (`cd "$DIR"`, `cd -`, a glob, `popd` with no `pushd`), or `GIT_DIR`, `GIT_WORK_TREE`, `--git-dir` or `--work-tree` points git somewhere else, the command is refused, and Claude is told to name the repository by its path.

A bare repository, or a command run inside a `.git` folder, is bundled from its git folder. A folder that is not a repository, or a repository with no commits yet, has nothing to save, so the command runs.

## What happens

- **Bundle saved:** `git bundle create ~/.cache/git-guard/<repo>-<time>-<reason>.bundle --all`, a toast saying where it is, and the restore command pinned in the status line. Then the command runs. One command that changes the same repository twice saves one bundle.
- **Uncommitted changes** to tracked files go in too. `git stash create` records them without touching the work tree, under a temporary ref, `refs/git-guard/worktree`, that is removed as soon as the bundle is written. When git can't record them (it can't while a merge has unmerged files), the bundle is still saved and the toast says the uncommitted changes are not in it.
- **Bundle fails:** the command is refused. Claude is told why, and how to save a bundle by hand.

The bundle is saved before Claude Code asks you to approve the command. If you then decline, the bundle stays.

## Restoring

The status line shows the command. It brings every branch, tag and remote-tracking ref in the bundle back under `refs/git-guard/restore/`, without changing your own branches:

```
git -C ~/code/app fetch ~/.cache/git-guard/app-20261114-120000-force-push.bundle '+refs/*:refs/git-guard/restore/*'
git -C ~/code/app reset --hard refs/git-guard/restore/heads/main
git -C ~/code/app stash apply refs/git-guard/restore/git-guard/worktree
```

The second line puts a branch back where it was. The third brings back uncommitted changes, when there were any.

## Keeping bundles

Bundles live in `~/.cache/git-guard`, which backups usually leave out. Each new bundle removes that repository's bundles beyond the newest ten, and any older than thirty days. Other files in the folder are never touched.

A bundle saved before `filter-repo` still holds everything the rewrite removed, such as a file you meant to purge. The toast says so: delete it once the rewrite is verified.

## Limits

- It only sees commands Claude runs through its Bash tool. Commands you run yourself in another terminal, or with `!`, are not checked.
- It matches command text, so a script or alias that does the risky thing inside can slip past it, and it does not look inside backticks.
- If a `cd` fails and the command goes on after `;`, git runs in the folder before it, which is not the one bundled. Use `&&`.
- A bundle holds what this clone has. It does not fetch first, so commits that exist only on the remote are not in it.
- It can't undo what a bundle doesn't hold: untracked files removed by `git clean`, and dropped stashes (`git stash drop`, `git stash clear`). `git reflog expire` and `git gc --prune` are not caught, since a bundle holds refs, not reflogs.
- Fails closed: if the guard itself errors on a risky command, that command is refused. Other commands are unaffected.

## Develop

```
claude plugin validate .
claude plugin test .
```
