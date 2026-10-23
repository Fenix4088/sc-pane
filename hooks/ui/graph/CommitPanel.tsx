// The selected commit, at the top of the Graph pane so it never breaks the lanes (FR-GR-7 to 9).
import type { GraphCommit, GraphState } from '../../../types'
import { GRAPH_CONFIRM_LABEL, LIST_LIMIT } from '../../constants'
import type { Kit, OnPress } from '../../types'
import { ConfirmRow, FileLine } from '../common'

type ConfirmKind = NonNullable<GraphState['confirm']>

export type CommitPanelActions = {
  close: OnPress
  startNaming: OnPress
  editName: (value: string) => void
  createBranch: (name: string) => () => void
  cancelNaming: OnPress
  ask: (kind: ConfirmKind) => OnPress
  confirm: (kind: ConfirmKind) => OnPress
  cancel: OnPress
  copyHash: OnPress
}

type Props = { kit: Kit; commit: GraphCommit; branch: string; graph: GraphState; actions: CommitPanelActions }

function question(kind: ConfirmKind, commit: GraphCommit, branch: string): string {
  if (kind === 'cherry-pick') return `Apply ${commit.hash} “${commit.subject}” on top of ${branch}?`
  if (kind === 'revert') return `Add a commit to ${branch} that undoes ${commit.hash} “${commit.subject}”?`

  return `Check out ${commit.hash} with no branch? Commits made there belong to no branch until you create one.`
}

export function CommitPanel(props: Props) {
  const { Box, Text, Button } = props.kit
  const { commit, actions } = props

  return (
    <Box flexDirection="column" gap="xs">
      <Box flexDirection="row" gap="sm" alignItems="center">
        <Text mono dimColor>
          {commit.hash}
        </Text>
        <Box flexGrow={1} flexShrink={1}>
          <Text weight="semibold" wrap="truncate-end">
            {commit.subject}
          </Text>
        </Box>
        <Button key="graph-close" label="✕" plain dimColor onPress={actions.close} />
      </Box>
      <Text size="footnote" dimColor>
        {`${commit.author} · ${commit.when}${commit.refs.length > 0 ? ` · ${commit.refs.join(', ')}` : ''}`}
      </Text>
      <Box flexDirection="column" gap="sm" paddingLeft={4} paddingY={1}>
        <CommitActionRow {...props} />
        <ConfirmAction {...props} />
        <NameBranch {...props} />
        <CommitFiles kit={props.kit} graph={props.graph} />
      </Box>
    </Box>
  )
}

function CommitActionRow(props: Props) {
  const { Box, Button } = props.kit
  const { actions } = props

  return (
    <Box flexDirection="row" gap="sm" flexWrap="wrap">
      <Button key="graph-branch" label="Create branch here…" onPress={actions.startNaming} />
      <Button key="graph-cherry-pick" label="Cherry-pick" onPress={actions.ask('cherry-pick')} />
      <Button key="graph-revert" label="Revert" onPress={actions.ask('revert')} />
      <Button key="graph-checkout" label="Checkout (detached)" onPress={actions.ask('checkout')} />
      <Button key="graph-copy" label="Copy hash" dimColor onPress={actions.copyHash} />
    </Box>
  )
}

// The question for cherry-pick, revert or checkout (BR-1).
function ConfirmAction(props: Props) {
  const { commit, graph, actions } = props
  if (!graph.confirm) return null

  return (
    <ConfirmRow
      kit={props.kit}
      text={question(graph.confirm, commit, props.branch)}
      confirmKey="graph-confirm"
      cancelKey="graph-cancel"
      confirmLabel={GRAPH_CONFIRM_LABEL[graph.confirm]}
      onConfirm={actions.confirm(graph.confirm)}
      onCancel={actions.cancel}
    />
  )
}

// Create branch here…: the new branch's name.
function NameBranch(props: Props) {
  const { Box, Button, Input } = props.kit
  const { commit, graph, actions } = props
  if (graph.naming === null || !Input) return null

  return (
    <Box flexDirection="row" gap="sm" alignItems="center" flexWrap="wrap">
      <Input
        key="graph-branch-name"
        placeholder={`New branch at ${commit.hash}`}
        value={graph.naming}
        submitLabel="create"
        autoFocus
        onInput={actions.editName}
        onSubmit={value => actions.createBranch(value)()}
      />
      <Button key="graph-branch-go" label="Create" variant="primary" onPress={actions.createBranch(graph.naming)} />
      <Button key="graph-branch-cancel" label="Cancel" dimColor onPress={actions.cancelNaming} />
    </Box>
  )
}

function CommitFiles(props: { kit: Kit; graph: GraphState }) {
  const { Box, Text } = props.kit
  const { files } = props.graph

  if (files === null) {
    return (
      <Text size="footnote" dimColor>
        Reading the changed files…
      </Text>
    )
  }
  if (files.length === 0) {
    return (
      <Text size="footnote" dimColor>
        No file changes against the first parent.
      </Text>
    )
  }

  return (
    <Box flexDirection="column">
      {files.slice(0, LIST_LIMIT).map(file => (
        <FileLine kit={props.kit} file={file} rowKey={`file:${file.path}`} />
      ))}
      {files.length > LIST_LIMIT && (
        <Text size="footnote" dimColor>
          …and {files.length - LIST_LIMIT} more
        </Text>
      )}
    </Box>
  )
}
