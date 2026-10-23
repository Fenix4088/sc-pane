// Types used inside the module only. The state contract (every `$.state` value) is `../types/index.d.ts`.
import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  InputProps,
  SelectProps,
  SvgProps,
  TextProps,
  UiPressArgument,
} from 'claude-code'

import type { FileChange, Repo } from '../types'

export type Settings = { model: string; includeBody: boolean }

export type RunInit = { cwd?: string; stdin?: string; timeoutMs?: number }

export type Status = Omit<Repo, 'root' | 'branches' | 'incoming' | 'outgoing' | 'stashes' | 'defaultBranch' | 'lastCommit'>

export type LineCounts = { added: number; removed: number }

export type StashMode = 'tracked' | 'untracked' | 'staged'

export type BranchOption = { value: string; label: string }

// One ref label of a graph row: a local branch with the remotes that hold the same name (`main ⇄ origin`),
// a remote branch alone, a tag, or a detached HEAD. `isHead` marks the checked-out one, drawn filled.
export type RefPill = { text: string; isHead: boolean }

// One row of the file tree: a folder that holds changed files directly, or a file; `depth` counts folders above.
export type TreeRow =
  | { kind: 'folder'; dir: string; label: string; depth: number; count: number }
  | { kind: 'file'; file: FileChange; depth: number }

// One row of the drawn graph: the commit's column and the strokes through its row. `top` runs from the row's
// top edge to its middle, `bottom` from the middle down, `full` straight through; `lane` picks the colour.
export type LaneSegment = { from: number; to: number; half: 'top' | 'bottom' | 'full'; lane: number }
// `isHead` draws the commit hollow, as the design marks the checked-out commit.
export type LaneRow = {
  hash: string
  col: number
  isMerge: boolean
  isHead: boolean
  segments: LaneSegment[]
  width: number
}

// One lane's two characters in a row: the glyph on the lane, then the joint towards the next lane.
export type LaneCell = { glyph: string; glyphLane: number; joint: string; jointLane: number }

// The elements a component draws with, taken from `$.ui.resolve(e)`. Mobile has no Input or Select,
// the terminal no Svg, so those are optional and every component has a text fallback. `isDesktop` turns on
// what only the desktop draws: hover reveals and translucent grounds.
export type Kit = {
  isDesktop: boolean
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Input?: ElementConstructor<InputProps>
  Select?: ElementConstructor<SelectProps>
  Svg?: ElementConstructor<SvgProps>
}

export type OnPress = (press: UiPressArgument) => void
