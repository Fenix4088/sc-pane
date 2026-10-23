import type { GraphState, PaneUi, Prompt } from '../types'
import type { StashMode } from './types'

export const PANE = 'sc-pane'
export const TITLE = 'Source Control'
export const GRAPH_PAGE = 50

// No terminal prompts (they would hang the call) and no editor for merge commits.
export const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_MERGE_AUTOEDIT: 'no' }
export const NETWORK_TIMEOUT = 120_000
export const REFRESH_INTERVAL = 5_000
export const DIFF_BUDGET = 40_000
export const UNTRACKED_FILE_BUDGET = 4_000
export const LIST_LIMIT = 50
export const BRANCH_LIMIT = 200
export const COMMIT_LIMIT = 20
// A Select takes 1 to 64 options, and a tree holding more is refused whole: the pane then draws nothing.
export const SELECT_LIMIT = 64

// Fields split by unit separators, records by record separators, so subjects can hold anything.
export const COMMIT_FORMAT = '%h%x1f%s%x1f%an%x1f%ae%x1f%cr%x1e'
export const STASH_FORMAT = '%gd%x1f%gs%x1f%cr%x1e'
// After git's own lane drawing, so a line holding a commit carries a record after its first unit separator.
export const GRAPH_FORMAT = '%x1f%h%x1f%p%x1f%D%x1f%s%x1f%an%x1f%ae%x1f%cr'

export const COMMITLINT_CONFIGS = [
  'commitlint.config.ts',
  'commitlint.config.js',
  'commitlint.config.cjs',
  'commitlint.config.mjs',
  '.commitlintrc',
  '.commitlintrc.json',
  '.commitlintrc.yml',
  '.commitlintrc.yaml',
  '.commitlintrc.js',
  '.commitlintrc.cjs',
]

// Fixed tones for the SVG icons (an image cannot follow the theme); each reads on light and dark grounds.
export const TONE = { muted: '#8A8A8A', green: '#3FA866' }

// The design's icons on a 24-unit grid, drawn by `svg()` where the surface has Svg.
export const ICON = {
  branch:
    '<circle cx="6.75" cy="5.25" r="2.25"/><circle cx="6.75" cy="18.75" r="2.25"/><circle cx="17.25" cy="7.5" r="2.25"/><path d="M6.75 7.5v9M17.25 9.75c0 4.5-10.5 3.75-10.5 6.75"/>',
  check: '<path d="M4.5 12.75l4.5 4.5 10.5-10.5"/>',
  file: '<path d="M6 2.25h7.5l4.5 4.5v15H6z"/><path d="M13.5 2.25v4.5H18"/>',
  folder:
    '<path d="M2.25 6.75a1.5 1.5 0 0 1 1.5-1.5H9l2.25 2.25h9a1.5 1.5 0 0 1 1.5 1.5v9.75a1.5 1.5 0 0 1-1.5 1.5H3.75a1.5 1.5 0 0 1-1.5-1.5z"/>',
}

// Grounds for the current tab, count pills, hash chips and the open commit, desktop only: translucent, so they
// sit on light and dark themes alike. The terminal draws those parts without a ground.
export const TINT = { neutral: '#8A8A8A33', selected: '#5AA2FF1F' }
// The text on a filled ref pill, dark on every lane tone.
export const ON_TONE = '#141414'

export const MAX_LANES = 24
// Text colours set by value: each reads on light and dark grounds, and eight stay apart where the theme has fewer.
// The first two are the design's blue and orange.
export const LANE_TONES = ['#5AA2FF', '#F0A04B', '#3FB27F', '#D9608A', '#9B7BE0', '#2FB5C4', '#E07A4B', '#8AA0B4']

// The box-drawing glyph for a lane by which of its sides carry a line through the row's middle.
export const GLYPHS: Record<string, string> = {
  '': ' ',
  u: '│',
  d: '│',
  ud: '│',
  l: '─',
  r: '─',
  lr: '─',
  ul: '╯',
  ur: '╰',
  dl: '╮',
  dr: '╭',
  udl: '┤',
  udr: '├',
  ulr: '┴',
  dlr: '┬',
  udlr: '┼',
}

// Commit subjects are cut to this many characters at most so the lanes keep their room; the open commit shows it all.
export const SUBJECT_CHARS = 60
// The subject length the message box counts towards, as git's own tools suggest.
export const SUBJECT_LIMIT = 72

// The busy label of Generate, drawn under the message box instead of in the status line.
export const GENERATING = 'Writing a message from your diff…'

// Defaults merged under saved state, so a value saved by an earlier version still reads whole.
export const PANE_UI_START: PaneUi = {
  tab: 'changes',
  view: 'list',
  collapsed: [],
  menu: null,
  confirm: null,
  branchFilter: null,
  more: null,
  prompt: null,
}

export const GRAPH_START: GraphState = {
  scope: 'auto',
  pageSize: GRAPH_PAGE,
  rows: [],
  hasMore: false,
  selected: null,
  files: null,
  naming: null,
  confirm: null,
  copied: null,
}

export const PROMPT_TITLE: Record<Prompt['kind'], string> = {
  stash: 'Stash',
  create: 'New branch from the current commit',
  createFrom: 'New branch from…',
  rename: 'Rename branch',
  delete: 'Delete branch',
  forceDelete: 'Delete branch',
  merge: 'Merge into the current branch',
}

export const PROMPT_GO: Record<Prompt['kind'], string> = {
  stash: 'Stash',
  create: 'Create',
  createFrom: 'Create',
  rename: 'Rename',
  delete: 'Delete',
  forceDelete: 'Delete anyway',
  merge: 'Merge',
}

export const STASH_LABEL: Record<StashMode, string> = {
  tracked: 'Stash tracked changes',
  untracked: 'Stash all changes',
  staged: 'Stash staged only',
}

export const GRAPH_CONFIRM_LABEL: Record<NonNullable<GraphState['confirm']>, string> = {
  'cherry-pick': 'Cherry-pick',
  revert: 'Revert',
  checkout: 'Check out',
}

export const NOTHING_TO_COMMIT = 'Nothing to commit: the working tree is clean.'
