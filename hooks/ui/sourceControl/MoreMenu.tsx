// The ⋯ menu: its row of groups, one group's commands, the inline form and the undo question (FR-MENU-*).
import type { MoreMenu as MoreGroup, Prompt, Repo } from '../../../types'
import { NOTHING_TO_COMMIT, PROMPT_GO, PROMPT_TITLE, STASH_LABEL } from '../../constants'
import { branchOptions, defaultBase, pickerOptions } from '../../helpers/branches'
import { rewriteBlock } from '../../helpers/view'
import type { BranchOption, Kit, OnPress, StashMode } from '../../types'
import { Caption, ConfirmRow } from '../common'

export type MoreActions = {
  open: (group: MoreGroup | null) => OnPress
  openPrompt: (prompt: Prompt) => OnPress
  // Explains why a dimmed command cannot run (FR-MENU-3).
  tell: (text: string) => OnPress
  restoreLatest: (ref: string, pop: boolean) => OnPress
  amend: OnPress
  askUndo: OnPress
  undo: OnPress
  cancel: OnPress
  commitAndSync: OnPress
  pullRebase: OnPress
  fetchPrune: OnPress
  pickChoice: (value: string) => void
  editText: (value: string) => void
  submit: (prompt: Prompt) => void
  closePrompt: OnPress
}

type Props = {
  kit: Kit
  repo: Repo
  group: MoreGroup | null
  prompt: Prompt | null
  confirm: string | null
  hasChanges: boolean
  actions: MoreActions
}

// The branch lists the commands and forms pick from.
type Choices = { all: BranchOption[]; others: BranchOption[]; otherLocal: BranchOption[]; base: string }

function choicesOf(repo: Repo): Choices {
  const all = branchOptions(repo)
  const others = all.filter(option => option.value !== 'detached' && option.value !== `local:${repo.branch}`)

  return { all, others, otherLocal: others.filter(option => option.value.startsWith('local:')), base: defaultBase(repo, all) }
}

export function MoreMenu(props: Props) {
  const { Box } = props.kit
  const isUndoAsked = props.confirm === 'undo' && props.repo.lastCommit !== null
  if (!props.group && !props.prompt && !isUndoAsked) return null

  const choices = choicesOf(props.repo)

  return (
    <Box flexDirection="column" gap="sm">
      <MenuRow {...props} choices={choices} />
      {isUndoAsked && <UndoConfirm {...props} />}
      {props.prompt && <PromptForm {...props} prompt={props.prompt} choices={choices} />}
    </Box>
  )
}

function MenuRow(props: Props & { choices: Choices }) {
  const { Box, Button } = props.kit
  const { repo, actions, choices } = props
  const back = <Button key="more-back" label="‹ Back" dimColor onPress={actions.open('groups')} />

  let buttons: JSX.Element[]
  if (props.group === 'groups') {
    buttons = [
      <Button key="more-stash" label="Stash" onPress={actions.open('stash')} />,
      <Button key="more-branch" label="Branch" onPress={actions.open('branch')} />,
      <Button key="more-commit" label="Commit" onPress={actions.open('commit')} />,
      <Button key="more-remote" label="Remote" onPress={actions.open('remote')} />,
      <Button key="more-close" label="Close" dimColor onPress={actions.open(null)} />,
    ]
  } else if (props.group === 'stash') {
    buttons = stashCommands(props)
  } else if (props.group === 'branch') {
    const isDetached = repo.branch === 'detached HEAD'
    const firstOther = choices.others[0]
    const firstLocal = choices.otherLocal[0]
    buttons = [
      <Button key="branch-create" label="Create…" onPress={actions.openPrompt({ kind: 'create', text: '', choice: '' })} />,
      <Button
        key="branch-create-from"
        label="Create from…"
        onPress={actions.openPrompt({ kind: 'createFrom', text: '', choice: choices.base })}
      />,
      <Button
        key="branch-rename"
        label="Rename…"
        dimColor={isDetached}
        onPress={
          isDetached
            ? actions.tell('No branch is checked out to rename.')
            : actions.openPrompt({ kind: 'rename', text: repo.branch, choice: '' })
        }
      />,
      <Button
        key="branch-delete"
        label="Delete…"
        dimColor={!firstLocal}
        onPress={
          firstLocal
            ? actions.openPrompt({ kind: 'delete', text: '', choice: firstLocal.value })
            : actions.tell('There is no other local branch to delete.')
        }
      />,
      <Button
        key="branch-merge"
        label="Merge…"
        dimColor={isDetached || !firstOther}
        onPress={
          !isDetached && firstOther
            ? actions.openPrompt({
                kind: 'merge',
                text: '',
                choice: choices.base !== `local:${repo.branch}` ? choices.base : firstOther.value,
              })
            : actions.tell('Check out a branch to merge into first.')
        }
      />,
    ]
  } else if (props.group === 'commit') {
    const blocked = rewriteBlock(repo)
    buttons = [
      <Button
        key="commit-amend"
        label="Amend last commit"
        dimColor={blocked !== null}
        onPress={blocked ? actions.tell(blocked) : actions.amend}
      />,
      <Button
        key="commit-undo"
        label="Undo last commit"
        dimColor={blocked !== null}
        onPress={blocked ? actions.tell(blocked) : actions.askUndo}
      />,
      <Button
        key="commit-sync"
        label="Commit & Sync"
        dimColor={!props.hasChanges}
        onPress={props.hasChanges ? actions.commitAndSync : actions.tell(NOTHING_TO_COMMIT)}
      />,
    ]
  } else if (props.group === 'remote') {
    buttons = [
      <Button
        key="remote-pull-rebase"
        label="Pull (rebase)"
        dimColor={!repo.upstream}
        onPress={repo.upstream ? actions.pullRebase : actions.tell('This branch has no upstream yet: publish it first.')}
      />,
      <Button key="remote-fetch-prune" label="Fetch (prune)" onPress={actions.fetchPrune} />,
    ]
  } else {
    return null
  }

  return (
    <Box flexDirection="row" gap="sm" flexWrap="wrap">
      {props.group === 'groups' ? buttons : [...buttons, back]}
    </Box>
  )
}

function stashCommands(props: Props): JSX.Element[] {
  const { Button } = props.kit
  const { repo, actions } = props
  const latest = repo.stashes[0]?.ref
  const noStash = actions.tell('There are no stashes yet.')
  const hasStaged = repo.staged.length > 0

  return [
    <Button key="stash-push" label="Stash" onPress={actions.openPrompt({ kind: 'stash', text: '', choice: 'tracked' })} />,
    <Button
      key="stash-untracked"
      label="Stash incl. untracked"
      onPress={actions.openPrompt({ kind: 'stash', text: '', choice: 'untracked' })}
    />,
    <Button
      key="stash-staged"
      label="Stash staged"
      dimColor={!hasStaged}
      onPress={hasStaged ? actions.openPrompt({ kind: 'stash', text: '', choice: 'staged' }) : actions.tell('Nothing is staged.')}
    />,
    <Button
      key="stash-apply-latest"
      label="Apply latest"
      dimColor={!latest}
      onPress={latest ? actions.restoreLatest(latest, false) : noStash}
    />,
    <Button
      key="stash-pop-latest"
      label="Pop latest"
      dimColor={!latest}
      onPress={latest ? actions.restoreLatest(latest, true) : noStash}
    />,
  ]
}

function UndoConfirm(props: Props) {
  const last = props.repo.lastCommit
  if (!last) return null

  return (
    <ConfirmRow
      kit={props.kit}
      text={`Undo ${last.hash} “${last.subject}”? Its changes stay staged and its message goes back in the box.`}
      confirmKey="undo-confirm"
      cancelKey="undo-cancel"
      confirmLabel="Undo"
      onConfirm={props.actions.undo}
      onCancel={props.actions.cancel}
    />
  )
}

// The inline form a command opens: a caption, a branch Select and/or a text Input, then Go and Cancel.
function PromptForm(props: Props & { prompt: Prompt; choices: Choices }) {
  const { Box, Text, Button, Input, Select } = props.kit
  const { prompt, choices, actions, repo } = props
  const { kind } = prompt
  const labelOf = (value: string) => choices.all.find(option => option.value === value)?.label ?? value
  const options =
    kind === 'delete'
      ? choices.otherLocal
      : kind === 'merge'
        ? choices.others
        : choices.all.filter(option => option.value !== 'detached')
  const hasChoice = kind === 'createFrom' || kind === 'delete' || kind === 'merge'
  const hasText = kind === 'stash' || kind === 'create' || kind === 'createFrom' || kind === 'rename'

  return (
    <Box flexDirection="column" gap="sm">
      <Caption kit={props.kit} text={kind === 'stash' ? (STASH_LABEL[prompt.choice as StashMode] ?? 'Stash') : PROMPT_TITLE[kind]} />
      {hasChoice && Select && (
        // At most 64 options (NFR-1); the "more" row names no branch, and picking it explains why.
        <Select key="prompt-choice" options={pickerOptions(options)} value={prompt.choice} onSelect={actions.pickChoice} />
      )}
      {kind === 'merge' && (
        <Text size="footnote" dimColor>
          {`Merges ${labelOf(prompt.choice)} into ${repo.branch}. Conflicts, if any, show in Changes marked !.`}
        </Text>
      )}
      {kind === 'delete' && (
        <Text size="footnote" dimColor>
          Deletes the local branch only. Its remote branch, if any, stays.
        </Text>
      )}
      {kind === 'forceDelete' && (
        <Text size="footnote" color="warning">
          {`${prompt.choice.replace(/^local:/, '')} has commits no other branch holds. Deleting it anyway loses them.`}
        </Text>
      )}
      {hasText && Input && (
        <Input
          key="prompt-text"
          placeholder={kind === 'stash' ? 'Message (optional)' : 'Branch name'}
          value={prompt.text}
          submitLabel={PROMPT_GO[kind].toLowerCase()}
          autoFocus
          onInput={actions.editText}
          onSubmit={value => actions.submit({ ...prompt, text: value })}
        />
      )}
      <Box flexDirection="row" gap="sm">
        <Button key="prompt-go" label={PROMPT_GO[kind]} variant="primary" onPress={() => actions.submit(prompt)} />
        <Button key="prompt-cancel" label="Cancel" dimColor onPress={actions.closePrompt} />
      </Box>
    </Box>
  )
}
