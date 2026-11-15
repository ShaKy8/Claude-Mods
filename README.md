# Claude-Mods

Claude Code mods by kyle, published as the `claude-mods` plugin marketplace.

| Plugin | What it does |
| --- | --- |
| [ship](ship/README.md) | Git state in the status line, plus `/ship` to stage, commit and push. |
| [boot-guard](boot-guard/README.md) | Takes a `snapper` snapshot before Bash commands that can change what boots. |
| [git-guard](git-guard/README.md) | Saves a `git bundle` of the repository before Bash commands that rewrite or delete git history. |

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

It runs the tests in `ship`, `boot-guard` and `git-guard` and exits non-zero if any fails. When you add a plugin, add its directory name to the loop in `test.sh`.
