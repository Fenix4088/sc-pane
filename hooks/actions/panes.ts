import type { EngineInterface } from 'claude-code'

import { GRAPH_PANE, PANE, TITLE } from '../constants'
import { isBusy, refresh } from '../store'
import { openGraph, refreshGraph } from './graph'

export function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: TITLE })
}

export async function isPaneOpen($: EngineInterface, id: string): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === id)
}

export async function runPaneCommand($: EngineInterface) {
  await refresh($).catch(() => null)
  await openPane($)

  return { text: 'Source Control pane opened.' }
}

export async function runGraphCommand($: EngineInterface) {
  await refresh($).catch(() => null)
  await openGraph($).catch(() => undefined)

  return { text: 'Commit graph opened.' }
}

// Answers a pane command that threw or ran out of time, so the person sees why instead of a skipped hook.
export function commandFailed() {
  return { text: 'Could not open the pane. Run the command again, or press ↻ in the pane if it opened.' }
}

// Picks up edits made outside the session (an editor, a terminal) while a pane is open.
export async function refreshOpenPanes($: EngineInterface) {
  if (await isBusy($)) return

  const panes = await $.ui.panes()
  if (panes.some(pane => pane.id === PANE || pane.id === GRAPH_PANE)) await refresh($)
  if (panes.some(pane => pane.id === GRAPH_PANE)) await refreshGraph($)
}

// After Claude's turn: the files may have changed under the panes.
export async function refreshAfterTurn($: EngineInterface) {
  await refresh($).catch(() => null)
  if (await isPaneOpen($, GRAPH_PANE).catch(() => false)) await refreshGraph($).catch(() => undefined)
}
