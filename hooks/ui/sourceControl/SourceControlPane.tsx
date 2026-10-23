// The Source Control tab's container: reads the store, binds every handler to `$`, and composes the
// sections. Components below it get data and handlers only, never `$` (the validator refuses it in props).
import type { EngineInterface } from 'claude-code'

import type { FileChange, MoreMenu as MoreGroup, PaneUi, Prompt, Repo, Stash } from '../../../types'
import { commitAndPush, commitAndSync, commitWithNotice, amend, undoLastCommit } from '../../actions/commit'
import { deleteBranch, createBranch, mergeBranch, renameBranch, switchBranch } from '../../actions/branch'
import { discardAll, discardFile, stageAll, stageDir, stageFile, unstageAll, unstageDir, unstageFile } from '../../actions/files'
import { refreshGraph } from '../../actions/graph'
import { generate } from '../../actions/message'
import { fetchAll, fetchPrune, pull, pullRebase, push, sync } from '../../actions/remote'
import { dropStash, restoreStash, stash } from '../../actions/stash'
import { GENERATING } from '../../constants'
import { draftOf, plural, splitPath } from '../../helpers/text'
import {
  clearNotice,
  editPrompt,
  readPaneView,
  requireRepo,
  run,
  setDraft,
  setNotice,
  setUi,
} from '../../store'
import type { Kit, OnPress, Settings, StashMode } from '../../types'
import { ConfirmCard, TopBar, Toast, type TabActions } from '../common'
import { BranchSection, type BranchActions } from './BranchSection'
import { Changes, type ChangesActions } from './Changes'
import { CommitList } from './CommitList'
import { CommitSection, type CommitActions } from './CommitSection'
import { MoreMenu, type MoreActions } from './MoreMenu'
import { Stashes, type StashActions } from './Stashes'

// What a pending question is about: the pane keeps one at a time and draws it in one card above the list.
type Asked =
  | { kind: 'all'; count: number; untracked: number }
  | { kind: 'file'; file: FileChange }
  | { kind: 'stash'; stash: Stash }
  | { kind: 'undo'; hash: string; subject: string }

function askedOf(repo: Repo, confirm: string | null): Asked | null {
  if (confirm === 'all' && repo.unstaged.length > 0) {
    return { kind: 'all', count: repo.unstaged.length, untracked: repo.unstaged.filter(file => file.code === 'U').length }
  }
  if (confirm === 'undo' && repo.lastCommit) return { kind: 'undo', hash: repo.lastCommit.hash, subject: repo.lastCommit.subject }
  if (confirm?.startsWith('file:')) {
    const file = repo.unstaged.find(one => one.path === confirm.slice('file:'.length))
    return file ? { kind: 'file', file } : null
  }
  if (confirm?.startsWith('stash:')) {
    const found = repo.stashes.find(one => String(one.index) === confirm.slice('stash:'.length))
    return found ? { kind: 'stash', stash: found } : null
  }

  return null
}

// The card's words and its buttons' keys and label (BR-1, FR-CHG-4, FR-STA-3, FR-COM-5).
function questionOf(asked: Asked): { text: string; confirmKey: string; cancelKey: string; label: string } {
  if (asked.kind === 'all') {
    const text =
      `Discard all ${plural(asked.count, 'change')}?` +
      (asked.untracked > 0 ? ` ${plural(asked.untracked, 'untracked file')} will be deleted.` : '') +
      ' This cannot be undone.'
    return { text, confirmKey: 'confirm-all', cancelKey: 'cancel-all', label: 'Discard all' }
  }
  if (asked.kind === 'file') {
    const { name } = splitPath(asked.file.path)
    const isUntracked = asked.file.code === 'U'
    return {
      text: isUntracked ? `Delete ${name}? It is not tracked, so this cannot be undone.` : `Discard your changes to ${name}?`,
      confirmKey: `confirm:${asked.file.path}`,
      cancelKey: `cancel:${asked.file.path}`,
      label: isUntracked ? 'Delete' : 'Discard',
    }
  }
  if (asked.kind === 'stash') {
    return {
      text: `Drop ${asked.stash.ref} “${asked.stash.message}”? This cannot be undone.`,
      confirmKey: `stash-confirm:${asked.stash.index}`,
      cancelKey: `stash-cancel:${asked.stash.index}`,
      label: 'Drop',
    }
  }

  return {
    text: `Undo ${asked.hash} “${asked.subject}”? Its changes stay staged and its message goes back in the box.`,
    confirmKey: 'undo-confirm',
    cancelKey: 'undo-cancel',
    label: 'Undo',
  }
}

export async function drawSourceControl($: EngineInterface, kit: Kit, settings: Settings) {
  const { Box, Text, Button } = kit
  const { stored, repo, draft, busy, notice, ui } = await readPaneView($)

  // Handler factories: each returns a press handler, so nothing runs while drawing.
  const act = (label: string, action: () => Promise<void>) => () => {
    void run($, label, action)
  }
  const tell = (text: string) => () => {
    void setNotice($, 'error', text)
  }
  const show = (change: Partial<PaneUi>) => () => {
    void setUi($, change)
  }
  const isOpen = (id: string) => !ui.collapsed.includes(id)
  const toggle = (id: string) =>
    show({ collapsed: isOpen(id) ? [...ui.collapsed, id] : ui.collapsed.filter(one => one !== id) })
  const ask = (confirm: string) => show({ confirm, menu: null, more: null })
  const cancel = show({ confirm: null })

  const tabs: TabActions = {
    showChanges: show({ tab: 'changes' }),
    // The tab moves at once; the history is read behind it.
    showGraph: () => {
      void (async () => {
        await setUi($, { tab: 'graph' })
        await run($, 'Reading history…', () => refreshGraph($))
      })()
    },
  }
  const isGenerating = busy === GENERATING
  const toast = <Toast kit={kit} busy={isGenerating ? null : busy} notice={notice} onDismiss={() => void clearNotice($)} />
  const refreshButton = (
    <Button key="refresh" label="↻" plain dimColor hotkey="r" onPress={act('Refreshing…', () => requireRepo($).then(() => undefined))} />
  )

  if (!repo) {
    return (
      <Box flexDirection="column" gap="md">
        <TopBar kit={kit} tab="changes" actions={tabs}>
          {refreshButton}
        </TopBar>
        {toast}
        <Text dimColor>{stored ? 'Reading the repository…' : 'This folder is not a git repository.'}</Text>
      </Box>
    )
  }

  const hasChanges = repo.staged.length + repo.unstaged.length > 0
  const isOutOfSync = repo.upstream !== null && (repo.ahead > 0 || repo.behind > 0)
  const isTree = ui.view === 'tree'

  const branch: BranchActions = {
    pick: value => {
      if (value === 'more') {
        void setUi($, { branchFilter: '', menu: null, more: null })
        return
      }
      void (async () => {
        await setUi($, { branchFilter: null })
        await run($, 'Switching branch…', () => switchBranch($, value))
      })()
    },
    search: value => void setUi($, { branchFilter: value }),
    closeSearch: show({ branchFilter: null }),
    publish: act('Publishing…', () => push($)),
    fetch: act('Fetching…', () => fetchAll($)),
    sync: act('Syncing…', () => sync($)),
  }

  const commit: CommitActions = {
    editMessage: value => void setDraft($, () => draftOf(value)),
    submitMessage: value => {
      void (async () => {
        await setDraft($, () => draftOf(value))
        await run($, 'Committing…', () => commitWithNotice($))
      })()
    },
    generate: act(GENERATING, () => generate($, settings)),
    commit: act('Committing…', () => commitWithNotice($)),
    toggleMenu: show({ menu: ui.menu === 'commit' ? null : 'commit', more: null, prompt: null }),
    commitStaged: act('Committing…', () => commitWithNotice($, 'staged')),
    commitAll: act('Committing…', () => commitWithNotice($, 'all')),
    commitAndPush: act('Committing and pushing…', () => commitAndPush($)),
    commitAndSync: act('Committing and syncing…', () => commitAndSync($)),
    amend: act('Amending…', () => amend($)),
    askUndo: ask('undo'),
    tell,
  }

  const changes: ChangesActions = {
    toggle,
    ask,
    stage: file => act('Staging…', () => stageFile($, file)),
    unstage: file => act('Unstaging…', () => unstageFile($, file)),
    stageDir: dir => act('Staging…', () => stageDir($, dir)),
    unstageDir: dir => act('Unstaging…', () => unstageDir($, dir)),
    stageAll: act('Staging…', () => stageAll($)),
    unstageAll: act('Unstaging…', () => unstageAll($)),
  }

  const stashes: StashActions = {
    toggle: toggle('stashes'),
    apply: one => act('Applying the stash…', () => restoreStash($, one.ref, false)),
    pop: one => act('Restoring the stash…', () => restoreStash($, one.ref, true)),
    askDrop: one => ask(`stash:${one.index}`),
  }

  const submitPrompt = (prompt: Prompt) => {
    const { kind, text, choice } = prompt
    if (kind === 'stash') void run($, 'Stashing…', () => stash($, choice as StashMode, text))
    else if (kind === 'create') void run($, 'Creating the branch…', () => createBranch($, text))
    else if (kind === 'createFrom') void run($, 'Creating the branch…', () => createBranch($, text, choice))
    else if (kind === 'rename') void run($, 'Renaming…', () => renameBranch($, text))
    else if (kind === 'delete' || kind === 'forceDelete') {
      const name = choice.replace(/^local:/, '')
      void run($, 'Deleting the branch…', () => deleteBranch($, name, kind === 'forceDelete'))
    } else void run($, 'Merging…', () => mergeBranch($, choice))
  }

  const more: MoreActions = {
    open: (group: MoreGroup | null): OnPress => show({ more: group, prompt: null, confirm: null, menu: null }),
    openPrompt: prompt => show({ prompt, more: null, confirm: null }),
    tell,
    pull: act('Pulling…', () => pull($)),
    push: act('Pushing…', () => push($)),
    fetch: act('Fetching…', () => fetchAll($)),
    pullRebase: act('Pulling with rebase…', () => pullRebase($)),
    fetchPrune: act('Fetching…', () => fetchPrune($)),
    restoreLatest: (ref, pop) => act(pop ? 'Restoring the stash…' : 'Applying the stash…', () => restoreStash($, ref, pop)),
    pickChoice: value => {
      if (value === 'more') {
        void setNotice($, 'error', 'Only the most recent branches fit here: switch to the one you want first, then use New branch….')
        return
      }
      void editPrompt($, { choice: value })
    },
    editText: value => void editPrompt($, { text: value }),
    submit: submitPrompt,
    closePrompt: show({ prompt: null }),
  }

  const asked = askedOf(repo, ui.confirm)
  const confirmAsked = (): OnPress => {
    if (!asked) return cancel
    if (asked.kind === 'all') return act('Discarding…', () => discardAll($))
    if (asked.kind === 'file') return act('Discarding…', () => discardFile($, asked.file))
    if (asked.kind === 'stash') return act('Dropping the stash…', () => dropStash($, asked.stash.ref))

    return act('Undoing…', () => undoLastCommit($))
  }
  const question = asked ? questionOf(asked) : null

  return (
    <Box flexDirection="column" gap="md">
      <TopBar kit={kit} tab="changes" actions={tabs}>
        <Button key="view" label={isTree ? '≡' : '├'} plain dimColor onPress={show({ view: isTree ? 'list' : 'tree' })} />
        {refreshButton}
        <Button
          key="more"
          label="⋯"
          plain
          dimColor
          hotkey="m"
          onPress={show({ more: ui.more ? null : 'main', prompt: null, confirm: null, menu: null })}
        />
      </TopBar>
      <MoreMenu kit={kit} repo={repo} group={ui.more} prompt={ui.prompt} actions={more} />
      <BranchSection kit={kit} repo={repo} filter={typeof ui.branchFilter === 'string' ? ui.branchFilter : null} actions={branch} />
      <CommitSection
        kit={kit}
        repo={repo}
        draft={draft}
        isGenerating={isGenerating}
        isMenuOpen={ui.menu === 'commit'}
        actions={commit}
      />
      {toast}
      {question && (
        <ConfirmCard
          kit={kit}
          text={question.text}
          confirmKey={question.confirmKey}
          cancelKey={question.cancelKey}
          confirmLabel={question.label}
          onConfirm={confirmAsked()}
          onCancel={cancel}
        />
      )}
      {hasChanges ? (
        <Changes kit={kit} staged={repo.staged} unstaged={repo.unstaged} collapsed={ui.collapsed} isTree={isTree} actions={changes} />
      ) : (
        <Box paddingY={2} justifyContent="center">
          <Text dimColor>No changes. The working tree is clean.</Text>
        </Box>
      )}
      <Stashes kit={kit} stashes={repo.stashes} isOpen={isOpen('stashes')} actions={stashes} />
      {isOutOfSync && (
        <Box flexDirection="column" gap="sm">
          <CommitList
            kit={kit}
            id="incoming"
            title="Incoming"
            count={repo.behind}
            commits={repo.incoming}
            direction="in"
            isOpen={isOpen('incoming')}
            onToggle={toggle('incoming')}
          />
          <CommitList
            kit={kit}
            id="outgoing"
            title="Outgoing"
            count={repo.ahead}
            commits={repo.outgoing}
            direction="out"
            isOpen={isOpen('outgoing')}
            onToggle={toggle('outgoing')}
          />
        </Box>
      )}
    </Box>
  )
}
