// The selected commit, opened under its row with the lanes carried on beside it (FR-GR-7 to 9): hash and Copy,
// author and age, the full subject, the changed files, then the actions and any question they ask.
import type { GraphCommit, GraphState } from '../../../types'
import { GRAPH_CONFIRM_LABEL, LIST_LIMIT, TINT } from '../../constants'
import { continuingCells } from '../../helpers/lanes'
import { wrapText } from '../../helpers/text'
import { codeColor } from '../../helpers/view'
import type { Kit, LaneCell, LaneRow, OnPress } from '../../types'
import { Lanes } from './GraphRow'

type ConfirmKind = NonNullable<GraphState['confirm']>

export type CommitPanelActions = {
  startNaming: OnPress
  editName: (value: string) => void
  createBranch: (name: string) => () => void
  cancelNaming: OnPress
  ask: (kind: ConfirmKind) => OnPress
  confirm: (kind: ConfirmKind) => OnPress
  cancel: OnPress
  copyHash: OnPress
}

type Props = {
  kit: Kit
  commit: GraphCommit
  lane: LaneRow | undefined
  lanes: number
  columns: number
  branch: string
  graph: GraphState
  actions: CommitPanelActions
}

function question(kind: ConfirmKind, commit: GraphCommit, branch: string): string {
  if (kind === 'cherry-pick') return `Apply ${commit.hash} “${commit.subject}” on top of ${branch}?`
  if (kind === 'revert') return `Add a commit to ${branch} that undoes ${commit.hash} “${commit.subject}”?`

  return `Check out ${commit.hash} with no branch? Commits made there belong to no branch until you create one.`
}

export function CommitPanel(props: Props) {
  const { Box, Text, Button } = props.kit
  const { kit, commit, graph, actions } = props
  const cells = props.lane ? continuingCells(props.lane, props.lanes) : []
  const line = { kit, cells, lanes: props.lanes }

  return (
    <Box flexDirection="column" backgroundColor={kit.isDesktop ? TINT.selected : undefined}>
      <PanelLine {...line}>
        <Text mono size="footnote" backgroundColor={kit.isDesktop ? TINT.neutral : undefined}>
          {kit.isDesktop ? ` ${commit.hash} ` : commit.hash}
        </Text>
        <Button key="graph-copy" label={graph.copied === commit.hash ? 'Copied' : 'Copy'} plain dimColor onPress={actions.copyHash} />
        <Text size="footnote" dimColor>
          {`${commit.author} · ${commit.when}`}
        </Text>
      </PanelLine>
      {wrapText(commit.subject, props.columns - props.lanes * 2 - 3).map(text => (
        <PanelLine {...line}>
          <Text>{text}</Text>
        </PanelLine>
      ))}
      <CommitFiles {...props} cells={cells} />
      <PanelLine {...line}>
        <Button key="graph-checkout" label="Check out" onPress={actions.ask('checkout')} />
        <Button key="graph-branch" label="Branch here…" onPress={actions.startNaming} />
        <Button key="graph-cherry-pick" label="Cherry-pick" onPress={actions.ask('cherry-pick')} />
        <Button key="graph-revert" label="Revert" onPress={actions.ask('revert')} />
      </PanelLine>
      <NameBranch {...props} cells={cells} />
      <ConfirmAction {...props} cells={cells} />
    </Box>
  )
}

// One line of the panel: the lanes that carry on below the commit, then the line's content.
function PanelLine(props: { kit: Kit; cells: LaneCell[]; lanes: number; children?: JSX.Children }) {
  const { Box } = props.kit

  return (
    <Box flexDirection="row" gap="sm" alignItems="center">
      <Lanes kit={props.kit} cells={props.cells} lanes={props.lanes} />
      <Box flexDirection="row" gap="sm" alignItems="center" flexGrow={1} flexShrink={1}>
        {props.children}
      </Box>
    </Box>
  )
}

function CommitFiles(props: Props & { cells: LaneCell[] }) {
  const { Box, Text } = props.kit
  const { files } = props.graph
  const line = { kit: props.kit, cells: props.cells, lanes: props.lanes }

  if (files === null || files.length === 0) {
    return (
      <PanelLine {...line}>
        <Text size="footnote" dimColor>
          {files === null ? 'Reading the changed files…' : 'No file changes against the first parent.'}
        </Text>
      </PanelLine>
    )
  }

  return (
    <Box flexDirection="column">
      {files.slice(0, LIST_LIMIT).map(file => {
        const delta = [file.added ? `+${file.added}` : '', file.removed ? `−${file.removed}` : ''].filter(Boolean).join(' ')

        return (
          <PanelLine {...line}>
            <Box key={`file:${file.path}`} flexDirection="row" gap="sm" alignItems="center" flexGrow={1} flexShrink={1}>
              <Text color={codeColor(file.code)} weight="bold" mono>
                {file.code}
              </Text>
              <Box flexGrow={1} flexShrink={1}>
                <Text size="footnote" wrap="truncate-start">
                  {file.path}
                </Text>
              </Box>
              <Text size="footnote" dimColor tabular>
                {delta}
              </Text>
            </Box>
          </PanelLine>
        )
      })}
      {files.length > LIST_LIMIT && (
        <PanelLine {...line}>
          <Text size="footnote" dimColor>
            …and {files.length - LIST_LIMIT} more
          </Text>
        </PanelLine>
      )}
    </Box>
  )
}

// Branch here…: the new branch's name.
function NameBranch(props: Props & { cells: LaneCell[] }) {
  const { Button, Input } = props.kit
  const { commit, graph, actions } = props
  if (graph.naming === null || !Input) return null

  return (
    <PanelLine kit={props.kit} cells={props.cells} lanes={props.lanes}>
      <Input
        key="graph-branch-name"
        placeholder={`New branch at ${commit.hash}`}
        value={graph.naming}
        submitLabel="create"
        autoFocus
        onInput={actions.editName}
        onSubmit={value => actions.createBranch(value)()}
      />
      <Button key="graph-branch-cancel" label="Cancel" onPress={actions.cancelNaming} />
      <Button key="graph-branch-go" label="Create" variant="primary" onPress={actions.createBranch(graph.naming)} />
    </PanelLine>
  )
}

// The question for check out, cherry-pick or revert (BR-1).
function ConfirmAction(props: Props & { cells: LaneCell[] }) {
  const { Box, Text, Button } = props.kit
  const { commit, graph, actions } = props
  if (!graph.confirm) return null

  const line = { kit: props.kit, cells: props.cells, lanes: props.lanes }

  return (
    <Box flexDirection="column">
      <PanelLine {...line}>
        <Box flexShrink={1}>
          <Text color="warning">{question(graph.confirm, commit, props.branch)}</Text>
        </Box>
      </PanelLine>
      <PanelLine {...line}>
        <Button key="graph-cancel" label="Cancel" onPress={actions.cancel} />
        <Button key="graph-confirm" label={GRAPH_CONFIRM_LABEL[graph.confirm]} variant="primary" onPress={actions.confirm(graph.confirm)} />
      </PanelLine>
    </Box>
  )
}
