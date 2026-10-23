# sc-pane: Source Control for Claude Code

A Source Control pane for Claude Code, with a Graph tab, modelled on VS Code's Source Control view and the Git Graph extension. Review and stage changes, write or generate a commit message, commit, push, pull, sync, switch and manage branches, stash, and read the commit history as a graph, all without leaving your Claude session.

It works in the terminal, the Claude desktop app's Code tab and the VS Code extension.

## Features

- **Changes:** staged and unstaged files as a list or a folder tree; stage, unstage and discard per file, per folder or all at once. Discarding always asks first.
- **Commit:** a multi-line message box (Enter commits); commit staged changes or everything, commit and push, commit and sync, amend, and undo the last commit. Amend and undo refuse a commit that is already on a remote.
- **✦ Generate:** Claude writes the commit message from your diff, following your repository's recent commit subjects and its commitlint config if it has one.
- **Sync:** fetch, pull, push, publish a new branch, and a one-click sync that pulls before it pushes. Incoming and outgoing commits are listed.
- **Branches:** switch to local or remote branches (with search when there are more than 64), create, create from a base, rename, delete and merge.
- **Stash:** stash with or without untracked files or only what is staged, then apply, pop or drop.
- **Graph:** commit history with branch lanes; open a commit under its row to see its message and files, and to branch there, cherry-pick, revert, check it out or copy its hash.
- **Commit checks:** if the repository has `@commitlint/cli` installed, messages are checked against its rules before committing.

## Requirements

- Claude Code 2.1.287 or later (terminal), or the Claude desktop app's Code tab.
- `git` on the PATH.
- Node.js only if you want the commitlint check.

## Install

Add this repository as a marketplace, then install the plugin:

```bash
claude plugin marketplace add <owner>/<repo>
claude plugin install sc-pane@ypliasov-mods
```

Inside a session you can run the same commands as `/plugin marketplace add <owner>/<repo>` and `/plugin install sc-pane@ypliasov-mods`. Then run `/reload-plugins` or start a new session.

### Updates

Auto-update is off by default for marketplaces added from GitHub. Turn it on in `/plugin` under **Marketplaces**, or update by hand:

```bash
claude plugin update sc-pane@ypliasov-mods
```

## Usage

In a git repository the Source Control pane opens when the session starts. You can also open it yourself:

| Command | Opens |
|---|---|
| `/sc-pane` | The pane on its Source Control tab |
| `/sc-pane-graph` | The pane on its Graph tab (also the **Graph** tab at the top of the pane) |

Keyboard shortcuts in the pane: `r` refresh, `c` commit, `g` generate a message, `s` sync, `f` fetch, `p` publish, `m` the `⋯` menu; with the menu open, `l` pull, `p` push and `f` fetch. Enter in the message box commits.

## Settings

Change these in `/plugin` → **Installed** → **sc-pane** → **Configure options**, or in `/config`.

| Option | Default | Effect |
|---|---|---|
| Commit message model | `haiku` | Model that writes generated messages: `haiku`, `sonnet` or `opus` |
| Generate a message body | on | Adds a short body under the subject when the change is not trivial |

## What it runs and what it sends

This plugin runs code on your machine with your permissions. Everything it does is listed here.

**Commands it runs**

- `git`, in the repository of your current session, for every read and every action you press. While a pane is open it re-reads the repository every 5 seconds and after each Claude turn. Git runs with terminal prompts and editors turned off, so it never waits for input. Network operations (fetch, pull, push) talk to your own git remotes with your existing git credentials.
- `node <repo>/node_modules/@commitlint/cli/cli.js`, only when that file exists in your repository, to check a commit message before committing. This runs the commitlint installed in your repository. Repository git hooks (Husky and others) are never run.

**Files it reads**

- Untracked files in your repository, when you press **✦ Generate** with nothing staged, so their content can be described.
- `commitlint.config.*` or `.commitlintrc*` in the repository root, when generating a message.

It writes no files itself; your repository changes only through the git commands above. **Copy hash** puts a commit hash on your clipboard.

**Data sent to the model**

Only when you press **✦ Generate**, the plugin sends a request to the Claude model you chose, through your existing Claude Code connection. The request contains:

- the staged diff, or the working-tree diff when nothing is staged, with its file summary;
- the content of untracked files (up to 4,000 characters each), when nothing is staged;
- your last 15 commit subjects;
- your commitlint config, if the repository has one.

Diff and untracked content together are capped at 40,000 characters. Do not press **✦ Generate** on changes that hold secrets you would not paste into a Claude conversation.

Nothing else is sent anywhere. The plugin makes no other network requests and collects no telemetry.

## Not included

There is no diff viewer, line-level staging, merge editor, blame, worktree, clone, tag or remote management, and no way to abort a merge, cherry-pick or revert that stopped on conflicts. Use git or your editor for those.

## Contributing

Issues and pull requests are welcome. The full specification, with requirement IDs, engine constraints and the test list, is in [`.claude/REQUIREMENTS.md`](.claude/REQUIREMENTS.md). Please reference requirement IDs in issues and commits, and update the specification in the same pull request as the behaviour it describes.

To work on the plugin locally, clone the repository and point `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` at the clone (section 3.1 of the specification has the details). Before opening a pull request:

```bash
npm install
npm run check
```

## Licence

[MIT](LICENSE)
