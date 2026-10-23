// The pane's state: every `$.state` value is declared, read and written here and nowhere else.
// The validator only follows an atom read or written in the file that declares it, so other files go
// through these functions. Reads made while drawing subscribe the pane; writes come from handlers.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Draft, GraphState, Notice, PaneUi, Prompt, Repo } from '../types'
import { GRAPH_START, PANE_UI_START } from './constants'
import { errorText } from './helpers/text'
import { isCurrentRepo, readRepo } from './repo'

const repoState = atom({ plugin: 'sc-pane', key: 'repo' } as const, null)
const draftState = atom({ plugin: 'sc-pane', key: 'draft' } as const, { subject: '', body: '' })
const busyState = atom({ plugin: 'sc-pane', key: 'busy' } as const, null)
const noticeState = atom({ plugin: 'sc-pane', key: 'notice' } as const, null)
const uiState = atom({ plugin: 'sc-pane', key: 'ui' } as const, PANE_UI_START)
const graphState = atom({ plugin: 'sc-pane', key: 'graph' } as const, GRAPH_START)

// `stored` is whatever was saved, `repo` the same only when it has the current shape.
export type PaneView = {
  stored: Repo | null
  repo: Repo | null
  draft: Draft
  busy: string | null
  notice: Notice | null
  ui: PaneUi
}

export type GraphView = Omit<PaneView, 'draft' | 'ui'> & { graph: GraphState }

// Everything the Source Control pane draws from, in one read.
export async function readPaneView($: EngineInterface): Promise<PaneView> {
  const stored = await read($, repoState)
  const draft = await read($, draftState)
  const busy = await read($, busyState)
  const notice = await read($, noticeState)
  // A value saved by an earlier version of the pane may lack the newer fields.
  const saved: Partial<PaneUi> = await read($, uiState)

  return { stored, repo: isCurrentRepo(stored) ? stored : null, draft, busy, notice, ui: { ...PANE_UI_START, ...saved } }
}

// Everything the Graph pane draws from, in one read.
export async function readGraphView($: EngineInterface): Promise<GraphView> {
  const stored = await read($, repoState)
  const graph = await readGraphState($)
  const busy = await read($, busyState)
  const notice = await read($, noticeState)

  return { stored, repo: isCurrentRepo(stored) ? stored : null, graph, busy, notice }
}

// The last read of the repository, without reading it again; null when missing or saved in an old shape.
export async function storedRepo($: EngineInterface): Promise<Repo | null> {
  const stored = await read($, repoState)

  return isCurrentRepo(stored) ? stored : null
}

export async function refresh($: EngineInterface): Promise<Repo | null> {
  const next = await readRepo($)

  // Write only on a change, so the periodic refresh does not redraw a pane mid-typing.
  if (JSON.stringify(await read($, repoState)) !== JSON.stringify(next)) {
    await update($, repoState, () => next)
  }

  return next
}

export async function requireRepo($: EngineInterface): Promise<Repo> {
  const repo = await refresh($)
  if (!repo) throw new Error('Not a git repository.')

  return repo
}

export async function isBusy($: EngineInterface): Promise<boolean> {
  return (await read($, busyState)) !== null
}

export async function setNotice($: EngineInterface, kind: Notice['kind'], text: string) {
  await update($, noticeState, () => ({ kind, text }))
}

export async function setUi($: EngineInterface, change: Partial<PaneUi>) {
  await update($, uiState, ui => ({ ...ui, ...change }))
}

// Changes the open form only if one is still open when the write lands.
export async function editPrompt($: EngineInterface, change: Partial<Prompt>) {
  await update($, uiState, ui => (ui.prompt ? { ...ui, prompt: { ...ui.prompt, ...change } } : ui))
}

export async function readDraft($: EngineInterface): Promise<Draft> {
  return read($, draftState)
}

export async function setDraft($: EngineInterface, change: (draft: Draft) => Draft) {
  await update($, draftState, change)
}

// One action at a time (FR-PANE-6): the label shows while it runs, and an error becomes the notice.
export async function run($: EngineInterface, label: string, action: () => Promise<void>) {
  if (await isBusy($)) return

  await update($, busyState, () => label)
  await update($, noticeState, () => null)
  await setUi($, { menu: null, confirm: null, more: null, prompt: null })
  try {
    await action()
  } catch (error) {
    await setNotice($, 'error', errorText(error))
  } finally {
    await update($, busyState, () => null)
  }
}

export async function readGraphState($: EngineInterface): Promise<GraphState> {
  const saved: Partial<GraphState> = await read($, graphState)

  return { ...GRAPH_START, ...saved }
}

export async function setGraph($: EngineInterface, change: Partial<GraphState>) {
  await update($, graphState, graph => ({ ...GRAPH_START, ...graph, ...change }))
}
