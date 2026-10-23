import type { EngineInterface } from 'claude-code'

import type { PaneUi } from '../../types'
import { PANE, TITLE } from '../constants'
import { isBusy, readTab, refresh, setUi } from '../store'
import { refreshGraph } from './graph'

// One pane with two tabs, Source Control and Graph (FR-PANE-1, FR-PANE-2).
export async function openPane($: EngineInterface, tab: PaneUi['tab'] = 'changes') {
  await setUi($, { tab })
  return $.ui.open({ id: PANE, title: TITLE })
}

export async function isPaneOpen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE)
}

export async function runPaneCommand($: EngineInterface) {
  await refresh($).catch(() => null)
  await openPane($)

  return { text: 'Source Control pane opened.' }
}

export async function runGraphCommand($: EngineInterface) {
  await refresh($).catch(() => null)
  await openPane($, 'graph')
  await refreshGraph($).catch(() => undefined)

  return { text: 'Commit graph opened.' }
}

// Answers a pane command that threw or ran out of time, so the person sees why instead of a skipped hook.
export function commandFailed() {
  return { text: 'Could not open the pane. Run the command again, or press ↻ in the pane if it opened.' }
}

// Picks up edits made outside the session (an editor, a terminal) while the pane is open.
export async function refreshOpenPanes($: EngineInterface) {
  if (await isBusy($)) return
  if (!(await isPaneOpen($))) return

  await refresh($)
  if ((await readTab($)) === 'graph') await refreshGraph($)
}

// After Claude's turn: the files may have changed under the pane.
export async function refreshAfterTurn($: EngineInterface) {
  await refresh($).catch(() => null)
  const isGraphShown = (await isPaneOpen($).catch(() => false)) && (await readTab($)) === 'graph'
  if (isGraphShown) await refreshGraph($).catch(() => undefined)
}
