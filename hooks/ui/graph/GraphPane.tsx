// The Graph pane's container: reads the store, binds handlers to `$`, draws the scope picker, the open
// commit and the rows (FR-GR-*). Components below it never receive `$`.
import type { EngineInterface, RenderSurface } from 'claude-code'

import type { GraphCommit, GraphState } from '../../../types'
import {
  branchAtCommit,
  checkoutDetached,
  cherryPick,
  copyHash,
  loadMoreGraph,
  refreshGraph,
  revertCommit,
  selectCommit,
  setGraphScope,
} from '../../actions/graph'
import { MAX_LANES } from '../../constants'
import { graphScopeOptions } from '../../helpers/branches'
import { layoutLanes } from '../../helpers/lanes'
import { errorText } from '../../helpers/text'
import { readGraphView, run, setGraph, setNotice } from '../../store'
import type { Kit } from '../../types'
import { StatusLine } from '../common'
import { CommitPanel, type CommitPanelActions } from './CommitPanel'
import { GraphRow } from './GraphRow'

export async function drawGraph($: EngineInterface, kit: Kit, surface: RenderSurface) {
  const { Box, Text, Button, Select } = kit
  const { stored, repo, graph, busy, notice } = await readGraphView($)

  const act = (label: string, action: () => Promise<void>) => () => {
    void run($, label, action)
  }
  // For actions that only move the pane's own state: no busy label, but an error still shows.
  const quietly = (action: () => Promise<void>) => () => {
    void action().catch(error => setNotice($, 'error', errorText(error)))
  }
  const edit = (change: Partial<GraphState>) => quietly(() => setGraph($, change))

  const refreshButton = (
    <Button key="graph-refresh" label="↻" plain dimColor onPress={act('Reading history…', () => refreshGraph($))} />
  )

  if (!repo) {
    return (
      <Box flexDirection="column" gap="md">
        <StatusLine kit={kit} busy={busy} notice={notice} />
        <Box flexDirection="row" gap="sm" alignItems="center">
          <Text dimColor>{stored ? 'Reading the repository…' : 'This folder is not a git repository.'}</Text>
          {refreshButton}
        </Box>
      </Box>
    )
  }

  const scopeOptions = graphScopeOptions(repo)
  const scope = scopeOptions.some(option => option.value === graph.scope) ? graph.scope : 'auto'
  const pickScope = (value: string) => {
    if (value !== 'more') quietly(() => setGraphScope($, value))()
  }

  const incoming = new Set(repo.incoming.map(one => one.hash))
  const outgoing = new Set(repo.outgoing.map(one => one.hash))
  const select = (hash: string) => quietly(() => selectCommit($, hash))

  const panelActions = (commit: GraphCommit): CommitPanelActions => ({
    close: select(commit.hash),
    startNaming: edit({ naming: '', confirm: null }),
    editName: value => void setGraph($, { naming: value }),
    createBranch: name => act('Creating the branch…', () => branchAtCommit($, commit, name)),
    cancelNaming: edit({ naming: null }),
    ask: kind => edit({ confirm: kind, naming: null }),
    confirm: kind =>
      kind === 'cherry-pick'
        ? act('Cherry-picking…', () => cherryPick($, commit))
        : kind === 'revert'
          ? act('Reverting…', () => revertCommit($, commit))
          : act('Checking out…', () => checkoutDetached($, commit)),
    cancel: edit({ confirm: null }),
    copyHash: press => void copyHash($, commit, press.surface),
  })

  const commits = graph.rows.flatMap(row => (row.commit ? [row.commit] : []))
  const selected = commits.find(commit => commit.hash === graph.selected) ?? null
  const laid = layoutLanes(commits)
  // Every row's lane block is as wide as the widest, so messages start in one column.
  const lanes = Math.min(MAX_LANES, Math.max(1, ...laid.map(row => row.width)))

  return (
    <Box flexDirection="column" gap="sm">
      <Box flexDirection="row" gap="sm" alignItems="center" justifyContent="space-between">
        {Select ? (
          <Select key="graph-scope" options={scopeOptions} value={scope} onSelect={pickScope} />
        ) : (
          <Text dimColor>{scopeOptions.find(option => option.value === scope)?.label}</Text>
        )}
        {refreshButton}
      </Box>
      <StatusLine kit={kit} busy={busy} notice={notice} />
      {selected && (
        <CommitPanel kit={kit} commit={selected} branch={repo.branch} graph={graph} actions={panelActions(selected)} />
      )}
      {graph.rows.length === 0 ? (
        <Text dimColor>No commits yet.</Text>
      ) : (
        <Box flexDirection="column">
          {commits.map((commit, index) => (
            <GraphRow
              kit={kit}
              commit={commit}
              lane={laid[index]}
              lanes={lanes}
              isSelected={selected?.hash === commit.hash}
              isIncoming={incoming.has(commit.hash)}
              isOutgoing={outgoing.has(commit.hash)}
              canHover={surface === 'desktop'}
              onSelect={select(commit.hash)}
            />
          ))}
        </Box>
      )}
      {graph.hasMore && (
        <Box>
          <Button key="graph-more" label="Load more" dimColor onPress={act('Reading history…', () => loadMoreGraph($))} />
        </Box>
      )}
    </Box>
  )
}
