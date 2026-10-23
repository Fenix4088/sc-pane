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

import type { Repo } from '../types'

export type Settings = { model: string; includeBody: boolean }

export type RunInit = { cwd?: string; stdin?: string; timeoutMs?: number }

export type Status = Omit<Repo, 'root' | 'branches' | 'incoming' | 'outgoing' | 'stashes' | 'defaultBranch' | 'lastCommit'>

export type LineCounts = { added: number; removed: number }

export type StashMode = 'tracked' | 'untracked' | 'staged'

export type BranchOption = { value: string; label: string }

export type SyncLine = { text: string; color: string; dot: string }

// One row of the drawn graph: the commit's column and the strokes through its row. `top` runs from the row's
// top edge to its middle, `bottom` from the middle down, `full` straight through; `lane` picks the colour.
export type LaneSegment = { from: number; to: number; half: 'top' | 'bottom' | 'full'; lane: number }
export type LaneRow = { hash: string; col: number; isMerge: boolean; segments: LaneSegment[]; width: number }

// One lane's two characters in a row: the glyph on the lane, then the joint towards the next lane.
export type LaneCell = { glyph: string; glyphLane: number; joint: string; jointLane: number }

// The elements a component draws with, taken from `$.ui.resolve(e)`. Mobile has no Input or Select,
// the terminal no Svg, so those are optional and every component has a text fallback.
export type Kit = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Input?: ElementConstructor<InputProps>
  Select?: ElementConstructor<SelectProps>
  Svg?: ElementConstructor<SvgProps>
}

export type OnPress = (press: UiPressArgument) => void
