// The message box, ✦ Generate and the commit split button (FR-MSG-1, FR-COM-1 to 4).
import type { Draft } from '../../../types'
import type { Kit, OnPress } from '../../types'
import { Caption } from '../common'

export type CommitActions = {
  editSubject: (value: string) => void
  removeBody: OnPress
  generate: OnPress
  commit: OnPress
  toggleMenu: OnPress
  commitAndPush: OnPress
  // Pressed instead of the others while there is nothing to commit, to say why (FR-COM-2).
  nothingToCommit: OnPress
}

type Props = {
  kit: Kit
  draft: Draft
  stagedCount: number
  hasChanges: boolean
  isMenuOpen: boolean
  actions: CommitActions
}

export function CommitSection(props: Props) {
  const { Box, Text, Button, Input } = props.kit
  const { draft, stagedCount, hasChanges, actions } = props
  const blockedOr = (press: OnPress) => (hasChanges ? press : actions.nothingToCommit)
  const variant = hasChanges ? 'primary' : 'secondary'

  return (
    <Box flexDirection="column" gap="sm">
      <Caption kit={props.kit} text="Commit message" />
      {Input ? (
        <Input
          key="message"
          placeholder="Describe your changes"
          value={draft.subject}
          submitLabel="save"
          onInput={actions.editSubject}
          onSubmit={actions.editSubject}
        />
      ) : (
        <Text>{draft.subject || 'No message yet.'}</Text>
      )}
      {draft.body && (
        <Text size="footnote" dimColor>
          {draft.body}
        </Text>
      )}
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        {draft.body ? <Button key="drop-body" label="Remove body" plain dimColor onPress={actions.removeBody} /> : <Text> </Text>}
        <Button key="generate" hotkey="g" dimColor={!hasChanges} onPress={blockedOr(actions.generate)}>
          ✦ Generate
        </Button>
      </Box>
      <Box flexDirection="row" gap="xs">
        <Button key="commit" variant={variant} dimColor={!hasChanges} hotkey="c" onPress={blockedOr(actions.commit)}>
          {stagedCount > 0 ? `Commit ${stagedCount} staged` : 'Commit all'} <Text mono dimColor>C</Text>
        </Button>
        <Button key="commit-menu" label="▾" variant={variant} dimColor={!hasChanges} onPress={blockedOr(actions.toggleMenu)} />
      </Box>
      {props.isMenuOpen && (
        <Box flexDirection="row" gap="sm">
          <Button key="commit-push" onPress={actions.commitAndPush}>
            {stagedCount > 0 ? 'Commit staged & Push' : 'Commit all & Push'}
          </Button>
        </Box>
      )}
    </Box>
  )
}
