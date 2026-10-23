export type FileChange = {
  path: string
  code: string
  // Line counts from `git diff --numstat`; absent for untracked and binary files.
  added?: number
  removed?: number
}

// Remote branches that already have a local branch of the same name are left out of `remote`.
export type Branches = { local: string[]; remote: string[] }

export type Commit = { hash: string; subject: string; author: string; when: string }

// `ref` is git's own name for it (`stash@{0}`); `branch` is where it was made.
export type Stash = { index: number; ref: string; message: string; branch: string; when: string }

// `isPushed` guards amend and undo: true when a remote branch already holds HEAD, or when that is unknown.
export type LastCommit = { hash: string; subject: string; isPushed: boolean }

export type Repo = {
  root: string
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  staged: FileChange[]
  unstaged: FileChange[]
  conflicts: number
  branches: Branches
  incoming: Commit[]
  outgoing: Commit[]
  stashes: Stash[]
  defaultBranch: string | null
  lastCommit: LastCommit | null
}

export type Draft = { subject: string; body: string }

export type Notice = { kind: 'ok' | 'error'; text: string }

// The ⋯ menu: its row of groups, or one group's commands.
export type MoreMenu = 'groups' | 'stash' | 'branch' | 'commit' | 'remote'

// An inline form under the menu: what it is for, the text typed, and the stash mode or branch picked.
export type Prompt = {
  kind: 'stash' | 'create' | 'createFrom' | 'rename' | 'delete' | 'forceDelete' | 'merge'
  text: string
  choice: string
}

// What the pane shows open: collapsed sections, an open menu, a discard waiting for its confirmation,
// the branch search's text while it is open, the ⋯ menu and its form.
export type PaneUi = {
  collapsed: string[]
  menu: 'commit' | 'sync' | null
  confirm: string | null
  branchFilter: string | null
  more: MoreMenu | null
  prompt: Prompt | null
}

export type GraphCommit = {
  hash: string
  parents: string[]
  refs: string[]
  subject: string
  author: string
  when: string
}

// One line of `git log --graph`: the lane drawing, and the commit when the line holds one.
export type GraphRow = { prefix: string; commit?: GraphCommit }

// `scope`: `auto` (current, upstream and default branch), `all`, or a branch picker value added to auto.
export type GraphState = {
  scope: string
  pageSize: number
  rows: GraphRow[]
  hasMore: boolean
  selected: string | null
  files: FileChange[] | null
  naming: string | null
  confirm: 'cherry-pick' | 'revert' | 'checkout' | null
}

declare module 'claude-code' {
  interface PluginState {
    'sc-pane': {
      repo: Repo | null
      draft: Draft
      busy: string | null
      notice: Notice | null
      ui: PaneUi
      graph: GraphState
    }
  }
}
