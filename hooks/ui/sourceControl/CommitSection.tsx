// The message box with ✦ and the subject count, then the commit split button and its menu
// (FR-MSG-1, FR-MSG-2, FR-COM-1 to 5).
import type { Draft, Repo } from '../../../types'
import { GENERATING, NOTHING_TO_COMMIT, SUBJECT_LIMIT } from '../../constants'
import { messageText } from '../../helpers/text'
import { rewriteBlock } from '../../helpers/view'
import type { Kit, OnPress } from '../../types'
import { MenuCard, MenuGroup, MenuItem } from '../common'

export type CommitActions = {
  editMessage: (value: string) => void
  // Enter in the message box commits, as the design's keyboard commit does.
  submitMessage: (value: string) => void
  generate: OnPress
  commit: OnPress
  toggleMenu: OnPress
  commitStaged: OnPress
  commitAll: OnPress
  commitAndPush: OnPress
  commitAndSync: OnPress
  amend: OnPress
  askUndo: OnPress
  // Explains why a dimmed command cannot run (FR-COM-2, FR-MENU-3).
  tell: (text: string) => OnPress
}

type Props = {
  kit: Kit
  repo: Repo
  draft: Draft
  isGenerating: boolean
  isMenuOpen: boolean
  actions: CommitActions
}

export function CommitSection(props: Props) {
  const { Box } = props.kit

  return (
    <Box flexDirection="column" gap="sm">
      <MessageBox {...props} />
      <CommitButton {...props} />
      {props.isMenuOpen && <CommitMenu {...props} />}
    </Box>
  )
}

function MessageBox(props: Props) {
  const { Box, Text, Button, Input } = props.kit
  const { draft, actions } = props
  const hasChanges = props.repo.staged.length + props.repo.unstaged.length > 0
  const length = draft.subject.length

  return (
    <Box flexDirection="column" gap="xs">
      {Input ? (
        <Input
          key="message"
          rows={3}
          placeholder="Message (Enter to commit)"
          value={messageText(draft)}
          submitLabel="commit"
          onInput={actions.editMessage}
          onSubmit={actions.submitMessage}
        />
      ) : (
        <Text>{messageText(draft) || 'No message yet.'}</Text>
      )}
      <Box flexDirection="row" gap="sm" alignItems="center" justifyContent="space-between">
        {props.isGenerating ? (
          <Text size="footnote" color="suggestion">
            {GENERATING}
          </Text>
        ) : (
          <Text> </Text>
        )}
        <Box flexDirection="row" gap="sm" alignItems="center">
          <Text size="caption" tabular color={length > SUBJECT_LIMIT ? 'warning' : undefined} dimColor={length <= SUBJECT_LIMIT}>
            {`${length}/${SUBJECT_LIMIT}`}
          </Text>
          <Button
            key="generate"
            label="✦"
            plain
            hotkey="g"
            dimColor={!hasChanges}
            onPress={hasChanges ? actions.generate : actions.tell('No changes to describe.')}
          />
        </Box>
      </Box>
    </Box>
  )
}

// Commit staged (n), Commit all (n), or a dimmed Nothing to commit; ▾ opens the commit menu.
function CommitButton(props: Props) {
  const { Box, Button } = props.kit
  const { repo, actions } = props
  const total = repo.staged.length + repo.unstaged.length
  const label =
    total === 0
      ? '✓ Nothing to commit'
      : repo.staged.length > 0
        ? `✓ Commit staged (${repo.staged.length})`
        : `✓ Commit all (${total})`

  return (
    <Box flexDirection="row" gap="xs">
      <Box flexGrow={1}>
        <Button
          key="commit"
          label={label}
          variant="primary"
          hotkey="c"
          dimColor={total === 0}
          onPress={total === 0 ? actions.tell(NOTHING_TO_COMMIT) : actions.commit}
        />
      </Box>
      <Button key="commit-menu" label="▾" variant="primary" onPress={actions.toggleMenu} />
    </Box>
  )
}

function CommitMenu(props: Props) {
  const { kit, repo, actions } = props
  const hasChanges = repo.staged.length + repo.unstaged.length > 0
  const blocked = rewriteBlock(repo)
  const unlessClean = (press: OnPress) => (hasChanges ? press : actions.tell(NOTHING_TO_COMMIT))

  return (
    <MenuCard kit={kit} isWide>
      <MenuGroup kit={kit}>
        <MenuItem
          kit={kit}
          id="commit-staged"
          label="Commit staged"
          isBlocked={repo.staged.length === 0}
          onPress={repo.staged.length > 0 ? actions.commitStaged : actions.tell('Nothing is staged.')}
        />
        <MenuItem kit={kit} id="commit-all" label="Commit all" isBlocked={!hasChanges} onPress={unlessClean(actions.commitAll)} />
        <MenuItem kit={kit} id="commit-push" label="Commit & push" isBlocked={!hasChanges} onPress={unlessClean(actions.commitAndPush)} />
        <MenuItem kit={kit} id="commit-sync" label="Commit & sync" isBlocked={!hasChanges} onPress={unlessClean(actions.commitAndSync)} />
      </MenuGroup>
      <MenuGroup kit={kit}>
        <MenuItem
          kit={kit}
          id="commit-amend"
          label="Amend last commit"
          isBlocked={blocked !== null}
          onPress={blocked ? actions.tell(blocked) : actions.amend}
        />
        <MenuItem
          kit={kit}
          id="commit-undo"
          label="Undo last commit"
          isBlocked={blocked !== null}
          onPress={blocked ? actions.tell(blocked) : actions.askUndo}
        />
      </MenuGroup>
    </MenuCard>
  )
}
