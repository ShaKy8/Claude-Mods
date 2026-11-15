# Claude-Mods

Claude Code mods by kyle, published as the `claude-mods` plugin marketplace.

| Plugin | What it does |
| --- | --- |
| [ship](ship/README.md) | Git state in the status line, plus `/ship` to stage, commit and push. |
| [boot-guard](boot-guard/README.md) | Takes a `snapper` snapshot before Bash commands that can change what boots. |
| [git-guard](git-guard/README.md) | Saves a `git bundle` of the repository before Bash commands that rewrite or delete git history. |
| [liftoff](https://github.com/ShaKy8/liftoff) | Watches GitHub Actions and Vercel after a push, in a row above the prompt. |
| [twin](https://github.com/ShaKy8/twin) | Keeps a public mirror in step with its private source. |
| [later](https://github.com/ShaKy8/later) | Checks that run later, by systemd, with the verdict waiting in your next session. |
| [undertaker](https://github.com/ShaKy8/undertaker) | Claude's `rm` moves files to the Trash instead of deleting them. |
| [crash-desk](https://github.com/ShaKy8/crash-desk) | Groups this machine's core dumps by signature and says when a crash is a repeat. |

The last five live in their own private repositories, listed here at their release tags, so only people with access to those repositories can install them.

Install one with:

```
/plugin install <plugin> --marketplace ShaKy8/Claude-Mods
```

## Develop

Validate the marketplace manifest from the repo root:

```
claude plugin validate .
```

`claude plugin test .` only works inside a plugin directory, since the root is not a plugin. To test every plugin in one go, run:

```
./test.sh
```

It runs the tests in `ship`, `boot-guard` and `git-guard` and exits non-zero if any fails. When you add a plugin, add its directory name to the loop in `test.sh`. The five plugins in their own repositories are tested there, by each one's `./check.sh` and CI.
