// The ⋯ menu: remote and stash commands and Branches…, the branch commands under it, and the inline form
// a command opens (FR-MENU-*).
import type { MoreMenu as MoreGroup, Prompt, Repo } from '../../../types'
import { PROMPT_GO, PROMPT_TITLE, STASH_LABEL } from '../../constants'
import { branchOptions, defaultBase, pickerOptions } from '../../helpers/branches'
import type { BranchOption, Kit, OnPress, StashMode } from '../../types'
import { MenuCard, MenuGroup, MenuItem } from '../common'

export type MoreActions = {
  open: (group: MoreGroup | null) => OnPress
  openPrompt: (prompt: Prompt) => OnPress
  // Explains why a dimmed command cannot run (FR-MENU-3).
  tell: (text: string) => OnPress
  pull: OnPress
  push: OnPress
  fetch: OnPress
  pullRebase: OnPress
  fetchPrune: OnPress
  restoreLatest: (ref: string, pop: boolean) => OnPress
  pickChoice: (value: string) => void
  editText: (value: string) => void
  submit: (prompt: Prompt) => void
  closePrompt: OnPress
}

type Props = { kit: Kit; repo: Repo; group: MoreGroup | null; prompt: Prompt | null; actions: MoreActions }

// The branch lists the commands and forms pick from.
type Choices = { all: BranchOption[]; others: BranchOption[]; otherLocal: BranchOption[]; base: string }

function choicesOf(repo: Repo): Choices {
  const all = branchOptions(repo)
  const others = all.filter(option => option.value !== 'detached' && option.value !== `local:${repo.branch}`)

  return { all, others, otherLocal: others.filter(option => option.value.startsWith('local:')), base: defaultBase(repo, all) }
}

export function MoreMenu(props: Props) {
  if (props.prompt) return <PromptForm {...props} prompt={props.prompt} choices={choicesOf(props.repo)} />
  if (!props.group) return null

  // A group saved by an earlier version of the menu opens the main list.
  return props.group === 'branch' ? <BranchCommands {...props} choices={choicesOf(props.repo)} /> : <MainCommands {...props} />
}

function MainCommands(props: Props) {
  const { kit, repo, actions } = props
  const latest = repo.stashes[0]?.ref
  const noStash = actions.tell('There are no stashes yet.')
  const noUpstream = actions.tell('This branch has no upstream yet: publish it first.')
  const hasStaged = repo.staged.length > 0
  const stashPrompt = (mode: StashMode) => actions.openPrompt({ kind: 'stash', text: '', choice: mode })

  return (
    <MenuCard kit={kit}>
      <MenuGroup kit={kit}>
        <MenuItem
          kit={kit}
          id="menu-pull"
          label="Pull"
          hotkey="l"
          isBlocked={!repo.upstream}
          onPress={repo.upstream ? actions.pull : noUpstream}
        />
        <MenuItem kit={kit} id="menu-push" label="Push" hotkey="p" onPress={actions.push} />
        <MenuItem kit={kit} id="menu-fetch" label="Fetch" hotkey="f" onPress={actions.fetch} />
        <MenuItem
          kit={kit}
          id="remote-pull-rebase"
          label="Pull (rebase)"
          isBlocked={!repo.upstream}
          onPress={repo.upstream ? actions.pullRebase : noUpstream}
        />
        <MenuItem kit={kit} id="remote-fetch-prune" label="Fetch (prune)" onPress={actions.fetchPrune} />
      </MenuGroup>
      <MenuGroup kit={kit}>
        <MenuItem kit={kit} id="stash-untracked" label={STASH_LABEL.untracked} onPress={stashPrompt('untracked')} />
        <MenuItem kit={kit} id="stash-push" label={STASH_LABEL.tracked} onPress={stashPrompt('tracked')} />
        <MenuItem
          kit={kit}
          id="stash-staged"
          label={STASH_LABEL.staged}
          isBlocked={!hasStaged}
          onPress={hasStaged ? stashPrompt('staged') : actions.tell('Nothing is staged.')}
        />
        <MenuItem
          kit={kit}
          id="stash-apply-latest"
          label="Apply latest stash"
          isBlocked={!latest}
          onPress={latest ? actions.restoreLatest(latest, false) : noStash}
        />
        <MenuItem
          kit={kit}
          id="stash-pop-latest"
          label="Pop latest stash"
          isBlocked={!latest}
          onPress={latest ? actions.restoreLatest(latest, true) : noStash}
        />
      </MenuGroup>
      <MenuGroup kit={kit}>
        <MenuItem kit={kit} id="more-branch" label="Branches…" onPress={actions.open('branch')} />
      </MenuGroup>
    </MenuCard>
  )
}

function BranchCommands(props: Props & { choices: Choices }) {
  const { kit, repo, actions, choices } = props
  const isDetached = repo.branch === 'detached HEAD'
  const firstOther = choices.others[0]
  const firstLocal = choices.otherLocal[0]

  return (
    <MenuCard kit={kit}>
      <MenuGroup kit={kit}>
        <MenuItem
          kit={kit}
          id="branch-create"
          label="New branch…"
          onPress={actions.openPrompt({ kind: 'create', text: '', choice: '' })}
        />
        <MenuItem
          kit={kit}
          id="branch-create-from"
          label="New branch from…"
          onPress={actions.openPrompt({ kind: 'createFrom', text: '', choice: choices.base })}
        />
        <MenuItem
          kit={kit}
          id="branch-rename"
          label="Rename branch…"
          isBlocked={isDetached}
          onPress={
            isDetached
              ? actions.tell('No branch is checked out to rename.')
              : actions.openPrompt({ kind: 'rename', text: repo.branch, choice: '' })
          }
        />
        <MenuItem
          kit={kit}
          id="branch-delete"
          label="Delete branch…"
          isBlocked={!firstLocal}
          onPress={
            firstLocal
              ? actions.openPrompt({ kind: 'delete', text: '', choice: firstLocal.value })
              : actions.tell('There is no other local branch to delete.')
          }
        />
        <MenuItem
          kit={kit}
          id="branch-merge"
          label="Merge into this branch…"
          isBlocked={isDetached || !firstOther}
          onPress={
            !isDetached && firstOther
              ? actions.openPrompt({
                  kind: 'merge',
                  text: '',
                  choice: choices.base !== `local:${repo.branch}` ? choices.base : firstOther.value,
                })
              : actions.tell('Check out a branch to merge into first.')
          }
        />
      </MenuGroup>
      <MenuGroup kit={kit}>
        <MenuItem kit={kit} id="more-back" label="‹ Back" onPress={actions.open('main')} />
      </MenuGroup>
    </MenuCard>
  )
}

// The inline form a command opens: a title, a branch Select and/or a text Input, then Cancel and the action.
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
    <Box flexDirection="column" gap="sm" borderStyle="round" borderDimColor paddingX={1}>
      <Text weight="semibold">{kind === 'stash' ? (STASH_LABEL[prompt.choice as StashMode] ?? 'Stash') : PROMPT_TITLE[kind]}</Text>
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
      <Box flexDirection="row" gap="sm" justifyContent="flex-end">
        <Button key="prompt-cancel" label="Cancel" onPress={actions.closePrompt} />
        <Button key="prompt-go" label={PROMPT_GO[kind]} variant="primary" onPress={() => actions.submit(prompt)} />
      </Box>
    </Box>
  )
}
