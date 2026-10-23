// The one pane: draws the tab the store says is shown (FR-PANE-1, FR-PANE-2).
import type { EngineInterface } from 'claude-code'

import { readTab } from '../store'
import type { Kit, Settings } from '../types'
import { drawGraph } from './graph/GraphPane'
import { drawSourceControl } from './sourceControl/SourceControlPane'

export async function drawPane($: EngineInterface, kit: Kit, columns: number, settings: Settings) {
  return (await readTab($)) === 'graph' ? drawGraph($, kit, columns) : drawSourceControl($, kit, settings)
}
