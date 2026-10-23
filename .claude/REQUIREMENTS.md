# Source Control mod: requirements and current state

Version 0.2.0, as of 2026-10-23. This document describes what the mod is for, how it is built, and every behaviour implemented so far, written as requirements another agent can extend or test against. Where this document and the code disagree, the code under `hooks/` is authoritative; update this file when behaviour changes.

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

In scope and built: the pane with its Source Control and Graph tabs, the `⋯` menu, stash, branch operations, commit extras, remote operations, AI commit message generation.

Visual design: the `sc-pane redesign` canvas (Source Control and Graph artboards, a dark 420 px frame) is the reference for layout, order, copy and behaviour. The engine draws Box, Text and native Buttons rather than HTML, so pixel detail (fills, single-side borders, icons inside buttons, overlays) is approximated; section 8 lists what differs (OPEN-9 to OPEN-12).

Out of scope (needs an editor rather than a pane): diff viewer, line-level staging, 3-way merge editor, blame, worktrees, clone, tags, remote management (add/remove remote), merge/rebase abort.

## 3. Architecture

### 3.1 Files

| Path | Role |
|---|---|
| `.claude-plugin/plugin.json` | Manifest: name `sc-pane`, `userConfig` options, `types` contract |
| `hooks/hooks.json` | Names the hooks module: `./register.tsx` |
| `hooks/register.tsx` | Entry point: reads `userConfig` and wires every hook (`on(...)` calls only) |
| `hooks/constants.ts` | Pane ids, limits, git formats, colours, glyphs, labels, state defaults |
| `hooks/types.ts` | Module-only types (`Settings`, `Kit`, `LaneRow`, `BranchOption`, …); state types stay in `types/index.d.ts` |
| `hooks/store.ts` | Declares every `$.state` atom and the only functions that read or write them (`readPaneView`, `readGraphView`, `refresh`, `run`, `setUi`, …) |
| `hooks/git.ts` | `git()`, `gitOrThrow()`, `failure()`: every git call goes through here |
| `hooks/repo.ts` | `readRepo()` and `isCurrentRepo()` |
| `hooks/helpers/` | Pure functions, no `$`: `parse.ts` (git output), `lanes.ts` (graph layout, lanes carried under an open commit), `branches.ts` (picker options, graph refs, ref labels), `tree.ts` (folder tree of changes), `text.ts` (cutting, wrapping, ages, message text), `view.ts` (colours, icons, `toKit`) |
| `hooks/actions/` | Git operations by area, each `($, …)`: `files`, `commit`, `message` (Generate), `remote`, `branch`, `stash`, `graph`, `panes` |
| `hooks/ui/pane.ts` | `drawPane`: draws the tab the store says is shown |
| `hooks/ui/common.tsx` | Components both tabs use: `TopBar` (tabs), `Toast` (status line), `ConfirmCard`, `MenuCard`/`MenuGroup`/`MenuItem` (dropdowns), `Icon`, `HoverActions`, `CountPill` |
| `hooks/ui/sourceControl/` | `SourceControlPane.tsx` (container) and its sections: `BranchSection`, `CommitSection` (message box, commit button and menu), `Changes` (list and tree), `SectionHeader`, `Stashes`, `CommitList`, `MoreMenu` |
| `hooks/ui/graph/` | `GraphPane.tsx` (container), `GraphRow` (and `Lanes`), `CommitPanel` |
| `types/index.d.ts` | State contract: every `$.state` value the module reads or writes |
| `tests/sc-pane.test.ts` | Engine tests with a fake git (20 tests) |
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
- UI is a tree of engine elements (`Box`, `Text`, `Button`, `Input`, `Select`, `Svg`), resolved per surface with `$.ui.resolve(e)` and handed to components as a `Kit` (`toKit(elements, surface)`). Surfaces: `desktop`, `terminal` (also `vscode`, `mobile` with fewer elements). The engine completes every table with stand-ins that draw nothing, so `toKit` drops `Svg` on the terminal and `Input`/`Select` on mobile by surface (NFR-12), and components draw their text fallbacks. `kit.isDesktop` turns on hover reveals and translucent grounds.
- One pane (`sc-pane`) with two tabs. `drawPane` reads `ui.tab` and calls the tab's container (`drawSourceControl`, `drawGraph`), which reads the store, binds every handler to `$` and composes function components. Components receive data, the `Kit` and ready-made handlers, never `$` (NFR-9).
- All git runs through one helper, `git($, args, init)`, with env `GIT_TERMINAL_PROMPT=0` and `GIT_MERGE_AUTOEDIT=no` (BR-3). Network calls get a 120 s timeout.
- The engine runs git with repository hooks off. Husky or other hooks never fire from the pane (see FR-COM-6 for the commitlint substitute).

### 3.3 State (`$.state`, plugin `sc-pane`)

| Key | Type | Holds |
|---|---|---|
| `repo` | `Repo \| null` | Last read of the repository (section 4.2) |
| `draft` | `Draft` | Commit message: `subject` is the box's first line, `body` everything from the first line break on, so the box reads back as typed; a body without a leading break (generated, or saved by 0.1) is drawn under a blank line |
| `busy` | `string \| null` | Label of the running action; blocks new actions |
| `notice` | `Notice \| null` | Last result line, `ok` or `error` |
| `ui` | `PaneUi` | Shown tab (`changes` or `graph`), list or tree view, collapsed sections and folders, the commit menu, pending confirmation, branch search text, `⋯` menu (`main` or `branch`), inline form |
| `graph` | `GraphState` | Graph scope, page size, rows, selected commit and its files, naming/confirm state, the hash Copy last put on the clipboard |

Rules:

- State outlives a module reload. Every reader tolerates values saved by older versions: `isCurrentRepo()` treats an old-shape `repo` as missing, and `ui`/`graph` are merged over defaults before use.
- `refresh()` writes `repo` only when it changed (it compares the JSON of the old and new read), so the 5 s timer does not redraw the pane while the user types.
- Render hooks never write state; handlers and other events do.

### 3.4 Refresh triggers

The repository is re-read:

1. At session start (and the pane opens on Source Control if the folder is a git repo).
2. Every 5 s while the pane is open and no action is running; the graph is re-read too while the Graph tab shows.
3. After every Claude turn (`turn.complete`), the graph too while the Graph tab shows.
4. After every action, and on the ↻ buttons.

## 4. Functional requirements

IDs are stable; reference them in commits and tests.

### 4.1 Pane lifecycle

| ID | Requirement |
|---|---|
| FR-PANE-1 | `/sc-pane` opens the pane (`$.ui.open({ id: 'sc-pane' })`) on its Source Control tab. It also opens automatically at session start in a git repository. |
| FR-PANE-2 | The pane has two tabs in its top bar, **Source Control** and **Graph**; the shown one is semibold (on a translucent ground on desktop), the other a dim button (`tab-changes`, `tab-graph`). `/sc-pane-graph`, or the Graph tab, shows the Graph tab and reads the history. There is no separate Graph pane. |
| FR-PANE-3 | Outside a git repository the pane shows "This folder is not a git repository." with a refresh button; while an old-shape state is being replaced it shows "Reading the repository…". |
| FR-PANE-4 | Top bar, right side. Source Control: list/tree toggle (`view`; `├` shows the tree, `≡` the list), ↻ refresh (hotkey `r`), `⋯` (hotkey `m`). Graph: ↻ refresh (`graph-refresh`, hotkey `r`). |
| FR-PANE-5 | One status line: the `busy` label (accent colour) while an action runs, otherwise the last `notice`, green for ok and amber for refusals and failures, with **✕** (`dismiss`) to clear it. It sits under the commit button on Source Control and under the scope picker on Graph (OPEN-10). Generate's busy label shows under the message box instead. Starting an action clears the notice and closes menus, forms and confirmations. |
| FR-PANE-6 | Only one action runs at a time (`run()` refuses while `busy` is set). |

### 4.2 Repository reading (`readRepo`)

| ID | Requirement |
|---|---|
| FR-READ-1 | Root from `git rev-parse --show-toplevel`; all other git calls run in the root. |
| FR-READ-2 | Status from `git status --porcelain=v2 --branch -z --untracked-files=all` (`parseStatus`): branch (or `detached HEAD`), upstream, ahead/behind, staged and unstaged files with status letters, conflicts (`!`), untracked files as `U`. Renames use the new path. |
| FR-READ-3 | Not read since 0.2.0: file rows no longer show line counts, so `readRepo` makes no `--numstat` calls. The Graph tab still reads counts for an open commit (FR-GR-8). |
| FR-READ-4 | Branches from `git for-each-ref --sort=-committerdate refs/heads refs/remotes` (`parseBranches`): current branch first, then local by recency, then remote branches that have no local branch of the same name. `origin/HEAD` excluded. Each list capped at 200. |
| FR-READ-5 | Incoming and outgoing commits (up to 20 each) from `git log HEAD..@{u}` and `@{u}..HEAD`, only when an upstream exists and ahead or behind is non-zero. The author shows as "you" when the email matches `git config user.email`. |
| FR-READ-6 | Stashes from `git stash list --format=%gd%x1f%gs%x1f%cr` (`parseStashes`): ref, index, branch it was made on, message, age. |
| FR-READ-7 | Default branch from `git symbolic-ref --short refs/remotes/origin/HEAD` (`origin/` stripped), or none. |
| FR-READ-8 | Last commit from `git log -1`; `isPushed` is true when `git branch -r --contains HEAD` lists anything or the call fails (unknown counts as pushed, BR-2). |

### 4.3 Branch section

| ID | Requirement |
|---|---|
| FR-BR-1 | The branch row: the branch icon (`⎇` on the terminal) and a dropdown (`Select key="branch"`) with the current branch selected, on the left; the sync state on the right (FR-BR-4). Option values: `local:<name>`, `remote:<remote>/<name>`, `detached`. Remote options are labelled `<ref> (remote)`. |
| FR-BR-2 | Picking a local branch runs `git switch <name>`. Picking a remote branch runs `git switch --track <ref>`, creating a local tracking branch, or `git switch <name>` if that local branch exists. Uncommitted changes move with the switch; git's refusal is shown as the error. |
| FR-BR-3 | When there are more than 64 branches, the dropdown shows the 63 most recent plus **More branches… (n more)**. That opens a search: an Input filters all branches by substring and a second Select (`branch-search`) lists up to 63 matches under a "pick one" prompt row. |
| FR-BR-4 | Sync state, right of the dropdown: in sync, a green ✓, "Up to date" and a ⤓ fetch button (`fetch`, hotkey `f`); ahead or behind, the **↻ Sync ↓n ↑m** button; no upstream, "Not published" and **↑ Publish**. The upstream's name is no longer shown. |

### 4.4 Remote actions

| ID | Requirement |
|---|---|
| FR-REM-1 | No upstream: **↑ Publish** (`publish`, hotkey `p`) runs `git push -u <origin or first remote> HEAD`. |
| FR-REM-2 | In sync: the ⤓ fetch button (`f`). |
| FR-REM-3 | Ahead or behind: **↻ Sync ↓n ↑m** (`sync`, hotkey `s`). Pull, Push and Fetch on their own are in the `⋯` menu (FR-REM-6). |
| FR-REM-4 | Sync (`syncOnce`) pulls first when behind, re-reads, then pushes when still ahead; it publishes when there is no upstream. Notice: "Synced: pulled n commits, then pushed m." or "Already in sync." |
| FR-REM-5 | Fetch runs `git fetch --all --prune`. Pull runs `git pull` with the user's own git config deciding merge or rebase. |
| FR-REM-6 | `⋯` menu, first group: **Pull** (`menu-pull`, `l`, needs an upstream), **Push** (`menu-push`, `p`; publishes when there is no upstream), **Fetch** (`menu-fetch`, `f`), **Pull (rebase)** (`git pull --rebase`, needs an upstream) and **Fetch (prune)** (`git fetch --prune`). |

### 4.5 Commit message and generation

| ID | Requirement |
|---|---|
| FR-MSG-1 | Three-row Input (`key="message"`, placeholder "Message (Enter to commit)") holding the whole message, subject on the first line. Every change is saved to the draft losslessly (`draftOf`, `messageText`). Enter commits (`submitLabel` "commit"; OPEN-12); a newline is typed as in the prompt box. Under the box: the subject's length against 72 (`n/72`, amber past 72) and ✦. |
| FR-MSG-2 | **✦** (`generate`, hotkey `g`, under the box on the right) writes the message with `$.model.complete`; while it runs, "Writing a message from your diff…" shows under the box in the accent colour. It describes the staged diff when anything is staged, otherwise the working tree including the content of untracked files. The diff is capped at 40,000 characters and each untracked file at 4,000. |
| FR-MSG-3 | The prompt includes the last 15 commit subjects and the first commitlint config found in the root (`commitlint.config.*`, `.commitlintrc*`), so the result follows the repo's type and scope conventions (BR-4). |
| FR-MSG-4 | Model and body are configurable (`userConfig.model`: `haiku` default, `sonnet`, `opus`; `userConfig.includeBody`: default true). Settings key: `pluginConfigs["sc-pane@<marketplace>"]`, or `sc-pane@inline` for a local copy. |
| FR-MSG-5 | The reply is cleaned (code fences and quotes stripped) and split into subject and body (`parseMessage`). API errors and empty replies become error notices. |

### 4.6 Commit actions

| ID | Requirement |
|---|---|
| FR-COM-1 | Primary button: **✓ Commit staged (n)** when something is staged, otherwise **✓ Commit all (n)** (hotkey `c`). Commit all stages everything with `git add -A` first. Commit runs `git commit -F -` with the message on stdin. |
| FR-COM-2 | Commit refuses with no message, with unresolved conflicts, or with nothing to commit. On a clean tree the button reads **✓ Nothing to commit**; it and ✦ draw dimmed and explain why when pressed. |
| FR-COM-3 | After a commit the draft is cleared and the notice shows "Committed <sha>: <subject>". |
| FR-COM-4 | The split button's **▾** (`commit-menu`) opens the commit menu under it: **Commit staged** (refuses when nothing is staged), **Commit all** (stages the unstaged files too, even when something is staged), **Commit & push**, **Commit & sync**, then **Amend last commit** and **Undo last commit** (FR-COM-5). It opens on a clean tree too, for amend and undo. |
| FR-COM-5 | Commit menu: **Amend last commit** (`git commit --amend -F -` with the box's message, or `--no-edit` when the box is empty) and **Undo last commit** (`git reset --soft HEAD~1`, confirmed in the question card; changes stay staged and the old subject goes back into the box). Both refuse when the last commit is pushed (BR-2) or there is none. |
| FR-COM-6 | Before any commit or amend with a message, if `<root>/node_modules/@commitlint/cli/cli.js` exists, the pane runs it with `node`, passing the message on stdin, and refuses on failure, listing the problems. This substitutes for the repo's commit-msg hook, which never fires from the pane. If node or commitlint fails to start, the commit proceeds. |

### 4.7 Changes lists

| ID | Requirement |
|---|---|
| FR-CHG-1 | Sections **STAGED** and **CHANGES**, collapsible with ▾/▸, with the count in a pill. Each row (list view): file icon (desktop), file name, folder dimmed as its last two names (`…/a/b`), the row actions, and the coloured status letter last. No line counts. Up to 50 rows per section, then "…and n more". |
| FR-CHG-2 | Row actions: staged row **−** unstages (`git restore --staged`); unstaged row **↺** discards and **+** stages (`git add --`). On desktop they appear on hover; on the terminal they always show. |
| FR-CHG-3 | Section actions: Staged **−** unstages all (`git reset -q`); Changes **↺** discards all and **+** stages all (`git add -A`). |
| FR-CHG-4 | Discard always confirms (BR-1) in the question card above the list (amber border, **Cancel** then the action, right-aligned), which holds one question at a time for the whole tab: a file or all discards, a stash drop, undo. A tracked file is restored with `git restore --worktree --` (the staged version is kept). An untracked file is deleted with `git clean -f --`, and the confirmation says it cannot be undone. Discard all runs `git restore --worktree -- .` and `git clean -fd`, and states how many untracked files will be deleted. |
| FR-CHG-5 | Clean tree: "No changes. The working tree is clean.", dimmed and centred where the lists would be, whatever the sync state. |
| FR-CHG-6 | When ahead or behind: **INCOMING** and **OUTGOING** sections listing commits (↓/↑, subject, hash · author · age). Not in the design; kept in its section style, as is STASHES. |
| FR-CHG-7 | Tree view (top bar `view`): each section lists its files under folder rows. Only folders that hold a changed file directly get a row, nested under the nearest such folder (`fileTree`); root files come last. A folder row: ▸/▾ (`toggle:<section>:dir:<dir>`, collapsed state in `ui.collapsed`), folder icon (desktop), name and file count, and **+** (`stage-dir:<dir>`, `git add -- <dir>`) or **−** (`unstage-dir:<dir>`, `git restore --staged -- <dir>`) on hover. The view is kept in `ui.view`. |

### 4.8 `⋯` menu

| ID | Requirement |
|---|---|
| FR-MENU-1 | `⋯` toggles a dropdown card under the top bar, right-aligned, in three groups: remote (FR-REM-6), stash (FR-STA-1, FR-STA-2), and **Branches…** (`more-branch`), which swaps the list for the branch commands (FR-BOP-*) plus **‹ Back**. The card is drawn in the flow, not over the content (OPEN-9). |
| FR-MENU-2 | Commands that need input replace the menu with a form card (`ui.prompt`): a title, a Select and/or Input as needed, then **Cancel** and the primary action. Enter in the Input submits. |
| FR-MENU-3 | Commands that cannot run draw dimmed and explain why when pressed (for example "Nothing is staged.", "There are no stashes yet."). |

### 4.9 Stash

| ID | Requirement |
|---|---|
| FR-STA-1 | `⋯` menu, stash group: **Stash all changes** (`stash-untracked`, `--include-untracked`), **Stash tracked changes** (`stash-push`, `git stash push`), **Stash staged only** (`stash-staged`, `--staged`, git 2.35+). Each opens a form with an optional message (`-m`). They refuse when there is nothing of that kind to stash. |
| FR-STA-2 | **Apply latest stash** and **Pop latest stash** act on `stash@{0}`. |
| FR-STA-3 | A **STASHES (n)** section appears when stashes exist: ref, message, "on <branch> · <age>", with **Apply**, **Pop** and **Drop** per row (hover-revealed on desktop). Drop confirms in the question card (FR-CHG-4). |
| FR-STA-4 | A restore that hits conflicts reports "restored with conflicts: resolve the files marked !. The stash was kept." |

### 4.10 Branch operations (`⋯` → Branches…)

| ID | Requirement |
|---|---|
| FR-BOP-1 | **New branch…**: name Input; `git switch -c <name>` from HEAD. |
| FR-BOP-2 | **New branch from…**: base Select (default: the default branch, local if it exists, else `origin/<default>`, else the current branch) plus name Input; `git switch -c <name> <base>`. |
| FR-BOP-3 | Names are validated with `git check-ref-format --branch` and refused if a local branch of that name exists. |
| FR-BOP-4 | **Rename branch…**: Input pre-filled with the current name; `git branch -m`. Refused on detached HEAD. The notice says the upstream is unchanged. |
| FR-BOP-5 | **Delete branch…**: Select of local branches except the current one; `git branch -d`. If git reports "not fully merged", the form changes to a warning with **Delete anyway** (`git branch -D`), a second confirmation. Only the local branch is deleted. |
| FR-BOP-6 | **Merge into this branch…**: Select of all other branches, local and remote (default: the default branch); `git merge --no-edit`. A conflict stops with "resolve the files marked !, stage them, then commit." |
| FR-BOP-7 | All branch Selects respect the 64-option limit (63 recent plus a "more" entry that explains how to reach older branches). |

### 4.11 Graph tab

| ID | Requirement |
|---|---|
| FR-GR-1 | Scope Select (`graph-scope`), with the loaded commit count on the right ("50+ commits" while more can load): **Current, upstream & default** (default; refs `HEAD`, upstream, default branch), **All branches** (`--branches --remotes`, excluding stash refs), or `+ <branch>` to add one branch to the default set. At most 64 options. |
| FR-GR-2 | History from `git log --graph --date-order --color=never --format=%x1f%h%x1f%p%x1f%D%x1f%s%x1f%an%x1f%ae%x1f%cr -n <pageSize> <refs> --` (`parseGraph`). 50 commits per page; **Load more** adds 50. |
| FR-GR-3 | Lanes are computed from each commit's parents (`layoutLanes`), not taken from git's ASCII: each commit gets a column, merges open a lane for the second parent, and lanes that wait for the same parent converge into it. |
| FR-GR-4 | Lanes are drawn as coloured box-drawing text (`laneCells`): `●` commit, `○` the checked-out commit (hollow, as the design marks HEAD), `│ ─ ╭ ╮ ╰ ╯ ├ ┤ ┬ ┴ ┼` for lines and curves. Each lane is a fixed two-cell box that never shrinks; the lane block is as wide as the widest row (max 24 lanes), so messages start in one column. Lane colours are fixed hex values that read on light and dark themes; the first two are the design's blue `#5AA2FF` and orange `#F0A04B`. |
| FR-GR-5 | Row: lanes, ref labels, the subject (a plain Button, `commit:<hash>`, the click target), and the age in short (`12m`, `3h`, `2d`, `5w`, `4mo`, `1y`; `shortAge`) on the right. Ref labels (`refPills`): a local branch and the remotes holding the same name share one (`main ⇄ origin`); the checked-out branch first, filled in its lane colour, others in lane-coloured text; then remote branches alone and tags; `origin/HEAD` hidden. One label in a pane under 80 columns, two from 80, each cut in the middle to a third of the row (`middleCut`), `+n` for more. The subject is cut with "…" to keep the row one line (60 characters at most). No hash, author or ↓/↑ on the row. Selected row: translucent blue ground on desktop. |
| FR-GR-6 | Removed in 0.2.0 (no hover card): the full subject shows in the open commit (FR-GR-7). |
| FR-GR-7 | Clicking a subject opens the commit under its row; clicking it again closes it. Every line of the panel starts with the lanes that carry on below the commit (`lanesBelow`, `continuingCells`), so the graph stays unbroken: hash (a chip on desktop), **Copy** (`graph-copy`, reads **Copied** after a copy), author · age; the full subject wrapped to the pane's width (`wrapText`); the changed files; the actions; then the branch-name form or the question when one is open. Translucent blue ground on desktop. |
| FR-GR-8 | Changed files (status letter, path cut from the start, `+a −r`): `git diff --name-status -z` and `--numstat -z` against the first parent (`parseNameStatus`), or `git diff-tree --root` for the root commit. Up to 50 files with status letter and +/− counts. |
| FR-GR-9 | Commit actions, in the design's order: **Check out** (`graph-checkout`, `git switch --detach <hash>`, warns that commits there belong to no branch); **Branch here…** (`graph-branch`, name Input; `git switch -c <name> <hash>`); **Cherry-pick** (`git cherry-pick [-m 1] <hash>`); **Revert** (`git revert --no-edit [-m 1] <hash>`). Check out, cherry-pick and revert confirm first, in amber text with **Cancel** and the action. `-m 1` is added for merge commits. **Copy** copies the full hash (`git rev-parse`) with `$.ui.copy`; only a failure shows in the status line. |
| FR-GR-10 | After a graph action the repository and the graph re-read. |

## 5. User-visible text conventions

- UK English, sentence case, no emoji on buttons (✦ ↻ ↓ ↑ ▾ ▸ ⋯ − + ↺ ✕ ✓ ⤓ ├ ≡ ⇄ are text glyphs).
- Errors say what to do next ("resolve the files marked !, stage them, then commit").
- Confirmations name the object and the consequence ("Drop stash@{0} “wip login”? This cannot be undone.").

## 6. Non-functional requirements and engine constraints

| ID | Requirement | Reason |
|---|---|---|
| NFR-1 | Every `Select` has 1 to 64 options with unique values. Use `pickerOptions(all, limit)`. | More than 64 refuses the whole tree; this blanked the pane in a repo with 104 branches. |
| NFR-2 | Text from commits and stashes passes through `printable()`, which replaces control characters with spaces. | A control character in a Button label refuses the whole tree. |
| NFR-3 | Buttons hold only strings and `Text` children. On desktop a Button is a native button that ignores child text styling and `mono`, so styled content goes outside Buttons. | Desktop rendering. |
| NFR-4 | Element keys are unique within a tree. Hover reveal uses a keyed `Box` with a child `display: 'none'`, `hover: { display: 'flex' }`, desktop only. | Engine hover model; the terminal reports no hover. |
| NFR-5 | Colours use theme keys (`success`, `warning`, `error`, `suggestion`) and `dimColor` so both themes work; the design's dark-only hex values map onto them. Fixed hex values only where no theme key fits: lane colours, the dark text on a filled ref label, SVG icons, and translucent grounds (`TINT`, eight-digit hex) that only the desktop draws. | Light and dark themes. |
| NFR-6 | Git never prompts: `GIT_TERMINAL_PROMPT=0`, `GIT_MERGE_AUTOEDIT=no`, messages via `-F -` on stdin. | BR-3. |
| NFR-7 | Do not run repository hook scripts to work around the engine's hooks-off rule. The commitlint check (FR-COM-6) is the only substitute. | Safety rule of the plugin engine. |
| NFR-8 | Readers tolerate state saved by older versions (section 3.3). | State outlives reloads. |
| NFR-9 | Functions the validator follows must be top-level declarations; `$` is passed only to top-level functions, never put in an object, a JSX prop or a spread. | `claude plugin validate` refuses otherwise. |
| NFR-10 | A state atom is read and written only in the file that declares it: all atoms live in `hooks/store.ts`, and other files call its functions. | The validator cannot follow an atom imported from another file and refuses the `read`/`update`. |
| NFR-11 | No variable or parameter other than the register argument is named `on`; handler bundles are named `actions`. | Precaution, not tested: the validator expects `on` only as `on("<event>", hook)`. |
| NFR-12 | Optional elements are chosen by surface, not by their presence in the table: no `Svg` on the terminal, no `Input` or `Select` on mobile (`toKit`). | The engine completes every table with stand-ins that draw nothing, so a presence check drew no ⎇ or ✓ on the terminal. |

## 7. Testing and verification

Commands, from the repository root (needs Node 20+ and the `claude` CLI on the PATH; `npm install` once for TypeScript):

```bash
npm run typecheck   # tsc against the engine types in .claude-plugin/types/
npm run validate    # claude plugin validate . --strict: engine refusals and manifest checks
npm test            # claude plugin test .
```

`.claude-plugin/types/` is generated by Claude Code and git-ignored, so `typecheck` only works on a machine where Claude Code has generated it; CI runs `validate` and `test` only. If `claude` is not on the PATH (the desktop app keeps its own copy), run the commands with the full path to its `claude` executable.

Current tests (all pass, each loops over the desktop and terminal surfaces where it mounts a pane):

1. FR-GR-2 NFR-2 parseGraph keeps git lanes and reads each commit record (includes the control-character case)
2. FR-GR-3 layoutLanes gives a side branch its own lane and joins it back at the merge (lane glyphs, hollow HEAD, lanes carried under an open commit, subject cut)
3. FR-GR-5 graph rows label refs and ages the way the design reads them
4. FR-MSG-1 the message box reads back exactly what was typed
5. FR-CHG-7 the tree view nests folders that hold changes and lists root files last
6. FR-GR-1 to 9 the Graph tab walks the chosen refs and acts on a commit opened under its row after asking
7. FR-STA-1 the ⋯ menu stashes, with or without new files, and a message
8. FR-STA-3 the Stashes section applies, pops, and drops only after confirming
9. FR-BOP-1 to 6 branch commands: create from a base, rename, merge, and delete with a second ask when unmerged
10. FR-COM-5 amend and undo refuse a pushed commit and work on an unpushed one
11. FR-CHG-1 FR-MSG-2 shows changes and commits a generated message
12. FR-PANE-1 FR-PANE-2 /sc-pane opens the pane on Source Control and /sc-pane-graph on Graph
13. FR-COM-2 refuses to commit without a message
14. FR-CHG-4 discards only after the question card is confirmed
15. FR-REM-4 sync pulls first, then pushes what is still ahead (also Push from the ⋯ menu, and ✕ on the status line)
16. FR-CHG-5 a clean, synced tree shows the empty state and dims commit
17. FR-COM-1 FR-COM-4 Enter in the message box commits, and the commit menu commits all
18. FR-CHG-7 the tree view groups changes by folder and stages a folder at once
19. FR-BR-3 NFR-1 with more branches than a picker holds, lists the recent ones and searches the rest
20. FR-BR-1 FR-BR-2 lists local and remote branches and switches between them

Pure helpers are imported in tests from their modules (`hooks/helpers/lanes`, `parse`, `text`, `branches`, `tree`), not from `register.tsx`.

Test pattern: `fakeGit(calls, statusText, { stashes, isPushed })` answers each git subcommand and records calls; `ran(calls, command)` returns the arguments of the commands the pane ran, minus the reads made on every refresh. Pane state persists between mounts within one test, so reset anything a test changes (for example the graph scope) before the next surface.

Real-data replay: capture real `git` output from a large repository (100+ remote branches, merge-heavy history) into a scratch test that answers `process.run` with it (the test runner does not run real git), then call `ui.drawn()` on both surfaces, in both views and both tabs, with a menu and a commit open. This found the 64-option and control-character refusals, which the fake data missed. Read captured files as UTF-8; Latin-1 turns non-ASCII names into control characters.

## 8. Known limitations and open questions

| ID | Item | Status |
|---|---|---|
| OPEN-1 | `Svg` elements did not draw in the desktop Graph pane (rows showed no space reserved). Cause unknown; one suspect is the empty `alt`. Lanes moved to text (FR-GR-4). Since 0.2.0 the design's icons (branch, check, file, folder) are `Svg` with a non-empty `alt` on desktop: check they show; if they do, SVG lanes with the design's rounded elbows may be recoverable. | Needs live check |
| OPEN-2 | Lane alignment relies on `Box width={2}` being honoured on desktop, and lane lines join only where a row is one text line tall: a native Button (the subject, the open commit's actions) may make a desktop row taller and leave gaps. Not yet confirmed live. | Needs live check |
| OPEN-3 | The message box was single-line and a generated body read-only. | Resolved in 0.2.0: `Input rows={3}` (FR-MSG-1) |
| OPEN-4 | Branch Selects in forms and the graph list only the 63 most recent branches; only the main branch picker has search. | Known |
| OPEN-5 | Esc does not close the `⋯` menu (Esc belongs to the pane frame); use `⋯` or Close. | Known |
| OPEN-6 | No abort for a merge, cherry-pick or revert that stopped on conflicts. | Not built |
| OPEN-7 | Repository hooks other than commit-msg (pre-commit, pre-push) never run from the pane. | Engine rule (NFR-7) |
| OPEN-8 | The 5 s refresh runs several git commands (two fewer since 0.2.0, FR-READ-3); on very large repositories this may need throttling. | Not measured |
| OPEN-9 | The design's dropdowns (`⋯`, commit ▾) overlay the content; here they are cards in the flow that push the content down. An absolutely positioned Box could overlay them, but its cell offsets on desktop are unverified. | Known |
| OPEN-10 | The design pins the status line to the pane's bottom; the engine scrolls the whole pane, so it sits under the commit button where it stays in view (FR-PANE-5). | Engine limit |
| OPEN-11 | Desktop Buttons are native: the design's filled white commit button, outlined Sync button, icons inside buttons and amber confirm button are drawn as the desktop's own primary and plain buttons with text glyphs. Translucent grounds (`TINT`) and `borderStyle="round"` cards need a live check on desktop. | Needs live check |
| OPEN-12 | The design commits on Ctrl+Enter; the engine's Input submits on Enter and reports no modifiers, so Enter commits. | Engine limit |
