// The Graph tab's container: reads the store, binds handlers to `$`, draws the scope picker and the rows,
// with the selected commit opened under its row (FR-GR-*). Components below it never receive `$`.
import type { EngineInterface } from 'claude-code'

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
import { graphScopeOptions, refPills, remoteNames } from '../../helpers/branches'
import { layoutLanes } from '../../helpers/lanes'
import { errorText } from '../../helpers/text'
import { clearNotice, readGraphView, run, setGraph, setNotice, setUi } from '../../store'
import type { Kit } from '../../types'
import { TopBar, Toast, type TabActions } from '../common'
import { CommitPanel, type CommitPanelActions } from './CommitPanel'
import { GraphRow } from './GraphRow'

export async function drawGraph($: EngineInterface, kit: Kit, columns: number) {
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
  const reread = act('Reading history…', () => refreshGraph($))

  const tabs: TabActions = { showChanges: () => void setUi($, { tab: 'changes' }), showGraph: reread }
  const topBar = (
    <TopBar kit={kit} tab="graph" actions={tabs}>
      <Button key="graph-refresh" label="↻" plain dimColor hotkey="r" onPress={reread} />
    </TopBar>
  )
  const toast = <Toast kit={kit} busy={busy} notice={notice} onDismiss={() => void clearNotice($)} />

  if (!repo) {
    return (
      <Box flexDirection="column" gap="md">
        {topBar}
        {toast}
        <Text dimColor>{stored ? 'Reading the repository…' : 'This folder is not a git repository.'}</Text>
      </Box>
    )
  }

  const scopeOptions = graphScopeOptions(repo)
  const scope = scopeOptions.some(option => option.value === graph.scope) ? graph.scope : 'auto'
  const pickScope = (value: string) => {
    if (value !== 'more') quietly(() => setGraphScope($, value))()
  }
  const select = (hash: string) => quietly(() => selectCommit($, hash))

  const panelActions = (commit: GraphCommit): CommitPanelActions => ({
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
  const laid = layoutLanes(commits)
  // Every row's lane block is as wide as the widest, so messages start in one column.
  const lanes = Math.min(MAX_LANES, Math.max(1, ...laid.map(row => row.width)))
  const remotes = remoteNames(repo)
  const count = `${commits.length}${graph.hasMore ? '+' : ''} commit${commits.length === 1 ? '' : 's'}`

  return (
    <Box flexDirection="column" gap="md">
      {topBar}
      <Box flexDirection="row" gap="sm" alignItems="center" justifyContent="space-between">
        {Select ? (
          <Select key="graph-scope" options={scopeOptions} value={scope} onSelect={pickScope} />
        ) : (
          <Text dimColor>{scopeOptions.find(option => option.value === scope)?.label}</Text>
        )}
        <Text size="footnote" dimColor>
          {count}
        </Text>
      </Box>
      {toast}
      {commits.length === 0 ? (
        <Text dimColor>No commits yet.</Text>
      ) : (
        <Box flexDirection="column">
          {commits.flatMap((commit, index) => {
            const isSelected = graph.selected === commit.hash
            const row = (
              <GraphRow
                kit={kit}
                commit={commit}
                lane={laid[index]}
                lanes={lanes}
                pills={refPills(commit.refs, remotes)}
                columns={columns}
                isSelected={isSelected}
                onSelect={select(commit.hash)}
              />
            )

            return isSelected
              ? [
                  row,
                  <CommitPanel
                    kit={kit}
                    commit={commit}
                    lane={laid[index]}
                    lanes={lanes}
                    columns={columns}
                    branch={repo.branch}
                    graph={graph}
                    actions={panelActions(commit)}
                  />,
                ]
              : [row]
          })}
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
