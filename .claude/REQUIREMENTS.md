# Source Control mod: requirements and current state

Version 0.1.0, as of 2026-10-23. This document describes what the mod is for, how it is built, and every behaviour implemented so far, written as requirements another agent can extend or test against. Where this document and the code disagree, the code in `hooks/register.tsx` is authoritative; update this file when behaviour changes.

## 1. Purpose

The mod adds a Source Control experience to Claude Code (desktop app Code tab and terminal), modelled on VS Code's Source Control view and Git Graph. The user works with git without leaving the Claude session: review changes, stage, write or generate a commit message, commit, sync with the remote, switch and manage branches, stash, and read the commit history as a graph.

Primary user: a developer working in a git repository inside a Claude Code session, typically on Windows with Git for Windows, often in repositories with many remote branches (100+) and merge-heavy history.

Business rules that apply everywhere:

- **BR-1 Nothing destructive without a confirmation.** Discard, delete, drop, undo, cherry-pick, revert and detached checkout all ask in the pane first.
- **BR-2 Never rewrite shared history.** Amend and undo refuse a commit that any remote branch already contains.
- **BR-3 Never hang on input.** Git must never wait for a terminal prompt or an editor.
- **BR-4 Respect the repository's conventions.** Generated messages follow the repo's recent subjects and commitlint config; commits are checked with the repo's commitlint before they are made.
- **BR-5 The pane must always draw.** A tree the engine refuses blanks the whole pane, so every engine limit is respected in code (see section 6).

## 2. Scope

In scope and built: the Source Control pane, the Graph pane, the `⋯` menu, stash, branch operations, commit extras, remote operations, AI commit message generation.

Out of scope (needs an editor rather than a pane): diff viewer, line-level staging, 3-way merge editor, blame, worktrees, clone, tags, remote management (add/remove remote), merge/rebase abort.

## 3. Architecture

### 3.1 Files

| Path | Role |
|---|---|
| `.claude-plugin/plugin.json` | Manifest: name `sc-pane`, `userConfig` options, `types` contract |
| `hooks/hooks.json` | Names the hooks module: `./register.tsx` |
| `hooks/register.tsx` | All logic and UI (about 2,500 lines) |
| `types/index.d.ts` | State contract: every `$.state` value the module reads or writes |
| `tests/sc-pane.test.ts` | Engine tests with a fake git (15 tests) |
| `.claude-plugin/types/` | Engine-generated API types; regenerated, never edited |
| `.claude-plugin/marketplace.json` | Makes the repository its own marketplace (plugin source `./`) |
| `.claude/CLAUDE.md` | Project instructions for Claude; imports this file (kept out of the root, where `plugin validate` flags it) |
| `.claude/REQUIREMENTS.md` | This document |
| `README.md`, `LICENSE`, `CHANGELOG.md` | Public documentation, MIT licence, release notes |
| `package.json` | Dev tooling: TypeScript and the check scripts |
| `.github/workflows/ci.yml` | Runs `plugin validate --strict` and `plugin test` on pushes and pull requests |

Local development: clone the repository and register the clone in `~/.claude/settings.json` (paths are absolute, separated by `;` on Windows and `:` elsewhere):

```json
"env": {
  "CLAUDE_CODE_PLUGIN_DIRS": "/absolute/path/to/sc-pane",
  "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
}
```

`CLAUDE_CODE_PLUGIN_DIR_WATCH=1` makes open sessions reload the mod when its files are saved. A plugin loaded this way is `sc-pane@inline` and silently replaces a marketplace install of the same name, so disable one of the two when testing the other.

### 3.2 Runtime model

- The module is a Claude Code function-hooks plugin. It runs in an isolated environment with no DOM and no Node; everything outside goes through `$` (`$.process.run` for git, `$.model.complete` for generation, `$.fs`, `$.ui`, `$.state`, `$.clock`).
- UI is a tree of engine elements (`Box`, `Text`, `Button`, `Input`, `Select`, `Svg`), resolved per surface with `$.ui.resolve(e)`. Surfaces: `desktop`, `terminal` (also `vscode`, `mobile` with fewer elements; `Input`/`Select` are absent on mobile and the code falls back to text).
- All git runs through one helper, `git($, args, init)`, with env `GIT_TERMINAL_PROMPT=0` and `GIT_MERGE_AUTOEDIT=no` (BR-3). Network calls get a 120 s timeout.
- The engine runs git with repository hooks off. Husky or other hooks never fire from the pane (see FR-COM-6 for the commitlint substitute).

### 3.3 State (`$.state`, plugin `sc-pane`)

| Key | Type | Holds |
|---|---|---|
| `repo` | `Repo \| null` | Last read of the repository (section 4.2) |
| `draft` | `Draft` | Commit message subject and body |
| `busy` | `string \| null` | Label of the running action; blocks new actions |
| `notice` | `Notice \| null` | Last result line, `ok` or `error` |
| `ui` | `PaneUi` | Collapsed sections, open menus, pending confirmation, branch search text, `⋯` menu group, inline form |
| `graph` | `GraphState` | Graph scope, page size, rows, selected commit and its files, naming/confirm state |

Rules:

- State outlives a module reload. Every reader tolerates values saved by older versions: `isCurrentRepo()` treats an old-shape `repo` as missing, and `ui`/`graph` are merged over defaults before use.
- `refresh()` writes `repo` only when it changed (`sameRepo()` compares JSON), so the 5 s timer does not redraw the pane while the user types.
- Render hooks never write state; handlers and other events do.

### 3.4 Refresh triggers

The repository is re-read:

1. At session start (and the Source Control pane opens if the folder is a git repo).
2. Every 5 s while either pane is open and no action is running; the graph is re-read too while the Graph pane is open.
3. After every Claude turn (`turn.complete`).
4. After every action, and on the ↻ buttons.

## 4. Functional requirements

IDs are stable; reference them in commits and tests.

### 4.1 Pane lifecycle

| ID | Requirement |
|---|---|
| FR-PANE-1 | `/sc-pane` opens the Source Control pane (`$.ui.open({ id: 'sc-pane' })`). It also opens automatically at session start in a git repository. |
| FR-PANE-2 | `/sc-pane-graph`, or the header's **Graph** button, opens the Graph pane (`id: 'sc-pane-graph'`) and reads the history. |
| FR-PANE-3 | Outside a git repository the pane shows "This folder is not a git repository." with a refresh button; while an old-shape state is being replaced it shows "Reading the repository…". |
| FR-PANE-4 | Header: title, ↻ refresh (hotkey `r`), **Graph**, `⋯` (hotkey `m`). |
| FR-PANE-5 | One status line under the header: the `busy` label while an action runs, otherwise the last `notice` (green for ok, red for error). Starting an action clears the notice and closes menus, forms and confirmations. |
| FR-PANE-6 | Only one action runs at a time (`run()` refuses while `busy` is set). |

### 4.2 Repository reading (`readRepo`)

| ID | Requirement |
|---|---|
| FR-READ-1 | Root from `git rev-parse --show-toplevel`; all other git calls run in the root. |
| FR-READ-2 | Status from `git status --porcelain=v2 --branch -z --untracked-files=all` (`parseStatus`): branch (or `detached HEAD`), upstream, ahead/behind, staged and unstaged files with status letters, conflicts (`!`), untracked files as `U`. Renames use the new path. |
| FR-READ-3 | Line counts per file from `git diff --numstat -z` and `git diff --cached --numstat -z` (`parseNumstat`); binary and untracked files have none. |
| FR-READ-4 | Branches from `git for-each-ref --sort=-committerdate refs/heads refs/remotes` (`parseBranches`): current branch first, then local by recency, then remote branches that have no local branch of the same name. `origin/HEAD` excluded. Each list capped at 200. |
| FR-READ-5 | Incoming and outgoing commits (up to 20 each) from `git log HEAD..@{u}` and `@{u}..HEAD`, only when an upstream exists and ahead or behind is non-zero. The author shows as "you" when the email matches `git config user.email`. |
| FR-READ-6 | Stashes from `git stash list --format=%gd%x1f%gs%x1f%cr` (`parseStashes`): ref, index, branch it was made on, message, age. |
| FR-READ-7 | Default branch from `git symbolic-ref --short refs/remotes/origin/HEAD` (`origin/` stripped), or none. |
| FR-READ-8 | Last commit from `git log -1`; `isPushed` is true when `git branch -r --contains HEAD` lists anything or the call fails (unknown counts as pushed, BR-2). |

### 4.3 Branch section

| ID | Requirement |
|---|---|
| FR-BR-1 | A branch dropdown (`Select key="branch"`) with the current branch selected. Option values: `local:<name>`, `remote:<remote>/<name>`, `detached`. Remote options are labelled `<ref> (remote)`. |
| FR-BR-2 | Picking a local branch runs `git switch <name>`. Picking a remote branch runs `git switch --track <ref>`, creating a local tracking branch, or `git switch <name>` if that local branch exists. Uncommitted changes move with the switch; git's refusal is shown as the error. |
| FR-BR-3 | When there are more than 64 branches, the dropdown shows the 63 most recent plus **More branches… (n more)**. That opens a search: an Input filters all branches by substring and a second Select (`branch-search`) lists up to 63 matches under a "pick one" prompt row. |
| FR-BR-4 | Status line under the dropdown: coloured dot and text. Green "Up to date with", blue "Ahead of" or "Behind", amber "Diverged from", grey "Not published yet", followed by the upstream name. |

### 4.4 Remote actions

| ID | Requirement |
|---|---|
| FR-REM-1 | No upstream: **↑ Publish branch** (hotkey `p`) runs `git push -u <origin or first remote> HEAD`; **Fetch**. |
| FR-REM-2 | In sync: **Fetch** (`f`), **↓ Pull 0** (`l`), **↑ Push 0** (`p`). |
| FR-REM-3 | Ahead or behind: primary **↻ Sync ↓n ↑m** (`s`), **Fetch**, and **⋯**, which reveals **Pull only** and **Push only**. A hint line explains the sync, for example "Sync pulls 1 commit, then pushes your 2." |
| FR-REM-4 | Sync (`syncOnce`) pulls first when behind, re-reads, then pushes when still ahead; it publishes when there is no upstream. Notice: "Synced: pulled n commits, then pushed m." or "Already in sync." |
| FR-REM-5 | Fetch runs `git fetch --all --prune`. Pull runs `git pull` with the user's own git config deciding merge or rebase. |
| FR-REM-6 | From the `⋯` Remote group: **Pull (rebase)** (`git pull --rebase`, needs an upstream) and **Fetch (prune)** (`git fetch --prune`). |

### 4.5 Commit message and generation

| ID | Requirement |
|---|---|
| FR-MSG-1 | Single-line Input (`key="message"`) holding the subject. Every keystroke is saved to `draft.subject`. A body, when present, shows read-only under it with **Remove body**. |
| FR-MSG-2 | **✦ Generate** (`g`) writes the message with `$.model.complete`. It describes the staged diff when anything is staged, otherwise the working tree including the content of untracked files. The diff is capped at 40,000 characters and each untracked file at 4,000. |
| FR-MSG-3 | The prompt includes the last 15 commit subjects and the first commitlint config found in the root (`commitlint.config.*`, `.commitlintrc*`), so the result follows the repo's type and scope conventions (BR-4). |
| FR-MSG-4 | Model and body are configurable (`userConfig.model`: `haiku` default, `sonnet`, `opus`; `userConfig.includeBody`: default true). Settings key: `pluginConfigs["sc-pane@<marketplace>"]`, or `sc-pane@inline` for a local copy. |
| FR-MSG-5 | The reply is cleaned (code fences and quotes stripped) and split into subject and body (`parseMessage`). API errors and empty replies become error notices. |

### 4.6 Commit actions

| ID | Requirement |
|---|---|
| FR-COM-1 | Primary button: **Commit n staged** when something is staged, otherwise **Commit all** (hotkey `c`). Commit all stages everything with `git add -A` first. Commit runs `git commit -F -` with the message on stdin. |
| FR-COM-2 | Commit refuses with no message, with unresolved conflicts, or with nothing to commit. On a clean tree the commit and generate buttons draw dimmed and explain why when pressed. |
| FR-COM-3 | After a commit the draft is cleared and the notice shows "Committed <sha>: <subject>". |
| FR-COM-4 | The commit split button (`▾`) offers **Commit & Push**. The `⋯` Commit group offers **Commit & Sync**. |
| FR-COM-5 | `⋯` Commit group: **Amend last commit** (`git commit --amend -F -` with the box's message, or `--no-edit` when the box is empty) and **Undo last commit** (`git reset --soft HEAD~1`, confirmed; changes stay staged and the old subject goes back into the box). Both refuse when the last commit is pushed (BR-2) or there is none. |
| FR-COM-6 | Before any commit or amend with a message, if `<root>/node_modules/@commitlint/cli/cli.js` exists, the pane runs it with `node`, passing the message on stdin, and refuses on failure, listing the problems. This substitutes for the repo's commit-msg hook, which never fires from the pane. If node or commitlint fails to start, the commit proceeds. |

### 4.7 Changes lists

| ID | Requirement |
|---|---|
| FR-CHG-1 | Sections **STAGED (n)** and **CHANGES (n)**, collapsible with ▾/▸. Each row: coloured status letter, file name, folder (dimmed, truncated from the start), green `+added` and red `−removed`. Up to 50 rows per section, then "…and n more". |
| FR-CHG-2 | Row actions: staged row **−** unstages (`git restore --staged`); unstaged row **↺** discards and **+** stages (`git add --`). On desktop they appear on hover; on the terminal they always show. |
| FR-CHG-3 | Section actions: Staged **−** unstages all (`git reset -q`); Changes **↺** discards all and **+** stages all (`git add -A`). |
| FR-CHG-4 | Discard always confirms inline (BR-1). A tracked file is restored with `git restore --worktree --` (the staged version is kept). An untracked file is deleted with `git clean -f --`, and the confirmation says it cannot be undone. Discard all runs `git restore --worktree -- .` and `git clean -fd`, and states how many untracked files will be deleted. |
| FR-CHG-5 | Clean tree, in sync: an empty state with a green check, "Working tree clean" and "Nothing to commit. Edits you make will show up here." Clean tree, out of sync: a single line "Working tree clean … 0 changes". |
| FR-CHG-6 | When ahead or behind: **INCOMING (n)** and **OUTGOING (n)** sections listing commits (↓/↑, subject, hash · author · age). |

### 4.8 `⋯` menu

| ID | Requirement |
|---|---|
| FR-MENU-1 | `⋯` toggles a row of groups: **Stash**, **Branch**, **Commit**, **Remote**, **Close**. A group replaces the row with its commands plus **‹ Back**. |
| FR-MENU-2 | Commands that need input open an inline form under the menu (`ui.prompt`): a caption, a Select and/or Input as needed, a primary action button and **Cancel**. Enter in the Input submits. |
| FR-MENU-3 | Commands that cannot run draw dimmed and explain why when pressed (for example "Nothing is staged.", "There are no stashes yet."). |

### 4.9 Stash

| ID | Requirement |
|---|---|
| FR-STA-1 | `⋯` Stash group: **Stash** (`git stash push`), **Stash incl. untracked** (`--include-untracked`), **Stash staged** (`--staged`, git 2.35+). Each opens a form with an optional message (`-m`). They refuse when there is nothing of that kind to stash. |
| FR-STA-2 | **Apply latest** and **Pop latest** act on `stash@{0}`. |
| FR-STA-3 | A **STASHES (n)** section appears when stashes exist: ref, message, "on <branch> · <age>", with **Apply**, **Pop** and **Drop** per row (hover-revealed on desktop). Drop confirms inline. |
| FR-STA-4 | A restore that hits conflicts reports "restored with conflicts: resolve the files marked !. The stash was kept." |

### 4.10 Branch operations (`⋯` Branch group)

| ID | Requirement |
|---|---|
| FR-BOP-1 | **Create…**: name Input; `git switch -c <name>` from HEAD. |
| FR-BOP-2 | **Create from…**: base Select (default: the default branch, local if it exists, else `origin/<default>`, else the current branch) plus name Input; `git switch -c <name> <base>`. |
| FR-BOP-3 | Names are validated with `git check-ref-format --branch` and refused if a local branch of that name exists. |
| FR-BOP-4 | **Rename…**: Input pre-filled with the current name; `git branch -m`. Refused on detached HEAD. The notice says the upstream is unchanged. |
| FR-BOP-5 | **Delete…**: Select of local branches except the current one; `git branch -d`. If git reports "not fully merged", the form changes to a warning with **Delete anyway** (`git branch -D`), a second confirmation. Only the local branch is deleted. |
| FR-BOP-6 | **Merge…**: Select of all other branches, local and remote (default: the default branch); `git merge --no-edit`. A conflict stops with "resolve the files marked !, stage them, then commit." |
| FR-BOP-7 | All branch Selects respect the 64-option limit (63 recent plus a "more" entry that explains how to reach older branches). |

### 4.11 Graph pane

| ID | Requirement |
|---|---|
| FR-GR-1 | Scope Select (`graph-scope`): **Current, upstream and default branch** (default; refs `HEAD`, upstream, default branch), **All branches** (`--branches --remotes`, excluding stash refs), or `+ <branch>` to add one branch to the default set. At most 64 options. |
| FR-GR-2 | History from `git log --graph --date-order --color=never --format=%x1f%h%x1f%p%x1f%D%x1f%s%x1f%an%x1f%ae%x1f%cr -n <pageSize> <refs> --` (`parseGraph`). 50 commits per page; **Load more** adds 50. |
| FR-GR-3 | Lanes are computed from each commit's parents (`layoutLanes`), not taken from git's ASCII: each commit gets a column, merges open a lane for the second parent, and lanes that wait for the same parent converge into it. |
| FR-GR-4 | Lanes are drawn as coloured box-drawing text (`laneCells`): `●` commit, `○` merge, `│ ─ ╭ ╮ ╰ ╯ ├ ┤ ┬ ┴ ┼` for lines and curves. Each lane is a fixed two-cell box that never shrinks; the lane block is as wide as the widest row (max 24 lanes), so messages start in one column. Lane colours are fixed hex values that read on light and dark themes. |
| FR-GR-5 | Row: lanes, hash (the click target), ↓/↑ for incoming/outgoing, up to two refs (HEAD in green, others in blue, `+n` for more, `HEAD -> x` shown as `HEAD → x`, `origin/HEAD` hidden), subject cut to 60 characters with "…" (`shortSubject`), author ("you" for the user) and age. |
| FR-GR-6 | On desktop, hovering a row whose subject was cut shows the full subject in an inverted-colour card under the row. |
| FR-GR-7 | Clicking a hash selects the commit; its panel opens at the top of the pane (so it never breaks the lanes) with full subject, author, age, refs, actions and changed files. Clicking again or **✕** closes it. |
| FR-GR-8 | Changed files: `git diff --name-status -z` and `--numstat -z` against the first parent (`parseNameStatus`), or `git diff-tree --root` for the root commit. Up to 50 files with status letter and +/− counts. |
| FR-GR-9 | Commit actions: **Create branch here…** (name Input; `git switch -c <name> <hash>`); **Cherry-pick** (`git cherry-pick [-m 1] <hash>`); **Revert** (`git revert --no-edit [-m 1] <hash>`); **Checkout (detached)** (`git switch --detach <hash>`, warns that commits there belong to no branch); **Copy hash** (full hash via `git rev-parse`, copied with `$.ui.copy`). Cherry-pick, revert and checkout confirm first. `-m 1` is added for merge commits. |
| FR-GR-10 | After a graph action both panes re-read. |

## 5. User-visible text conventions

- UK English, sentence case, no emoji on buttons (✦ ↻ ↓ ↑ ▾ ⋯ − + ↺ ✕ are text glyphs).
- Errors say what to do next ("resolve the files marked !, stage them, then commit").
- Confirmations name the object and the consequence ("Drop stash@{0} “wip login”? This cannot be undone.").

## 6. Non-functional requirements and engine constraints

| ID | Requirement | Reason |
|---|---|---|
| NFR-1 | Every `Select` has 1 to 64 options with unique values. Use `pickerOptions(all, limit)`. | More than 64 refuses the whole tree; this blanked the pane in a repo with 104 branches. |
| NFR-2 | Text from commits and stashes passes through `printable()`, which replaces control characters with spaces. | A control character in a Button label refuses the whole tree. |
| NFR-3 | Buttons hold only strings and `Text` children. On desktop a Button is a native button that ignores child text styling and `mono`, so styled content goes outside Buttons. | Desktop rendering. |
| NFR-4 | Element keys are unique within a tree. Hover reveal uses a keyed `Box` with a child `display: 'none'`, `hover: { display: 'flex' }`, desktop only. | Engine hover model; the terminal reports no hover. |
| NFR-5 | Colours use theme keys (`success`, `warning`, `error`, `suggestion`, `inactive`) so both themes work. Fixed hex values only where no theme key fits (lane colours, SVG icons). | Light and dark themes. |
| NFR-6 | Git never prompts: `GIT_TERMINAL_PROMPT=0`, `GIT_MERGE_AUTOEDIT=no`, messages via `-F -` on stdin. | BR-3. |
| NFR-7 | Do not run repository hook scripts to work around the engine's hooks-off rule. The commitlint check (FR-COM-6) is the only substitute. | Safety rule of the plugin engine. |
| NFR-8 | Readers tolerate state saved by older versions (section 3.3). | State outlives reloads. |
| NFR-9 | Functions the validator follows must be top-level declarations; `$` is passed only to top-level functions. | `claude plugin validate` refuses otherwise. |

## 7. Testing and verification

Commands, from the repository root (needs Node 20+ and the `claude` CLI on the PATH; `npm install` once for TypeScript):

```bash
npm run typecheck   # tsc against the engine types in .claude-plugin/types/
npm run validate    # claude plugin validate . --strict: engine refusals and manifest checks
npm test            # claude plugin test .
```

`.claude-plugin/types/` is generated by Claude Code and git-ignored, so `typecheck` only works on a machine where Claude Code has generated it; CI runs `validate` and `test` only. If `claude` is not on the PATH (the desktop app keeps its own copy), run the commands with the full path to its `claude` executable.

Current tests (all pass, each loops over the desktop and terminal surfaces where it mounts a pane):

1. parseGraph keeps git lanes and reads each commit record (includes the control-character case)
2. layoutLanes gives a side branch its own lane and joins it back at the merge (lane glyphs and subject cut)
3. the graph pane walks the chosen refs and acts on a selected commit after asking
4. the ⋯ menu stashes, with or without new files, and a message
5. the Stashes section applies, pops, and drops only after confirming
6. branch commands: create from a base, rename, merge, and delete with a second ask when unmerged
7. amend and undo refuse a pushed commit and work on an unpushed one
8. shows changes with line counts and commits a generated message
9. refuses to commit without a message
10. discards only after the row is confirmed
11. sync pulls first, then pushes what is still ahead
12. a clean, synced tree shows the empty state and dims commit
13. with more branches than a picker holds, lists the recent ones and searches the rest
14. lists local and remote branches and switches between them
15. /sc-pane opens the pane and /sc-pane-graph the graph

Test pattern: `fakeGit(calls, statusText, { stashes, isPushed })` answers each git subcommand and records calls; `ran(calls, command)` returns the arguments of the commands the pane ran, minus the reads made on every refresh. Pane state persists between mounts within one test, so reset anything a test changes (for example the graph scope) before the next surface.

Real-data replay: capture real `git` output from a large repository (100+ remote branches, merge-heavy history) into a scratch test that answers `process.run` with it, then call `ui.drawn()` on both surfaces. This found the 64-option and control-character refusals, which the fake data missed. Read captured files as UTF-8; Latin-1 turns non-ASCII names into control characters.

## 8. Known limitations and open questions

| ID | Item | Status |
|---|---|---|
| OPEN-1 | `Svg` elements did not draw in the desktop Graph pane (rows showed no space reserved). Cause unknown; one suspect is the empty `alt`. Lanes moved to text (FR-GR-4). Check whether the branch icon (`Svg`, `alt="Branch"`) shows in the Source Control pane: if it does, SVG lanes may be recoverable. | Open |
| OPEN-2 | Lane alignment relies on `Box width={2}` being honoured on desktop. Not yet confirmed live. | Needs live check |
| OPEN-3 | The message box is single-line; a generated body is read-only. | By design of `Input` |
| OPEN-4 | Branch Selects in forms and the graph list only the 63 most recent branches; only the main branch picker has search. | Known |
| OPEN-5 | Esc does not close the `⋯` menu (Esc belongs to the pane frame); use `⋯` or Close. | Known |
| OPEN-6 | No abort for a merge, cherry-pick or revert that stopped on conflicts. | Not built |
| OPEN-7 | Repository hooks other than commit-msg (pre-commit, pre-push) never run from the pane. | Engine rule (NFR-7) |
| OPEN-8 | The 5 s refresh runs several git commands; on very large repositories this may need throttling. | Not measured |
