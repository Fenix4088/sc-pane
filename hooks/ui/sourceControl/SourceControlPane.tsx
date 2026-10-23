// The Source Control pane's container: reads the store, binds every handler to `$`, and composes the
// sections. Components below it get data and handlers only, never `$` (the validator refuses it in props).
import type { EngineInterface, RenderSurface } from 'claude-code'

import type { MoreMenu as MoreGroup, PaneUi, Prompt } from '../../../types'
import { commitAndPush, commitAndSync, commitWithNotice, amend, undoLastCommit } from '../../actions/commit'
import { deleteBranch, createBranch, mergeBranch, renameBranch, switchBranch } from '../../actions/branch'
import { discardAll, discardFile, stageAll, stageFile, unstageAll, unstageFile } from '../../actions/files'
import { openGraph } from '../../actions/graph'
import { generate } from '../../actions/message'
import { fetchAll, fetchPrune, pull, pullRebase, push, sync } from '../../actions/remote'
import { dropStash, restoreStash, stash } from '../../actions/stash'
import { NOTHING_TO_COMMIT } from '../../constants'
import { editPrompt, readPaneView, requireRepo, run, setDraft, setNotice, setUi } from '../../store'
import type { Kit, OnPress, Settings, StashMode } from '../../types'
import { StatusLine } from '../common'
import { BranchSection, type BranchActions } from './BranchSection'
import { Changes, type ChangesActions } from './Changes'
import { CleanState } from './CleanState'
import { CommitList } from './CommitList'
import { CommitSection, type CommitActions } from './CommitSection'
import { Header, type HeaderActions } from './Header'
import { MoreMenu, type MoreActions } from './MoreMenu'
import { Stashes, type StashActions } from './Stashes'

export async function drawSourceControl($: EngineInterface, kit: Kit, surface: RenderSurface, settings: Settings) {
  const { Box, Text } = kit
  const { stored, repo, draft, busy, notice, ui } = await readPaneView($)
  // Row actions appear on hover where the pointer is reported; the terminal shows them always.
  const revealOnHover = surface === 'desktop'

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
  const ask = (confirm: string) => show({ confirm, menu: null })
  const cancel = show({ confirm: null })

  const header: HeaderActions = {
    refresh: act('Refreshing…', () => requireRepo($).then(() => undefined)),
    graph: act('Reading history…', () => openGraph($)),
    more: show({ more: ui.more ? null : 'groups', prompt: null, confirm: null, menu: null }),
  }

  if (!repo) {
    return (
      <Box flexDirection="column" gap="md">
        <Header kit={kit} isRepo={false} actions={header} />
        <StatusLine kit={kit} busy={busy} notice={notice} />
        <Text dimColor>{stored ? 'Reading the repository…' : 'This folder is not a git repository.'}</Text>
      </Box>
    )
  }

  const hasChanges = repo.staged.length + repo.unstaged.length > 0
  const isOutOfSync = repo.upstream !== null && (repo.ahead > 0 || repo.behind > 0)

  const branch: BranchActions = {
    pick: value => {
      if (value === 'more') {
        void setUi($, { branchFilter: '', menu: null })
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
    pull: act('Pulling…', () => pull($)),
    push: act('Pushing…', () => push($)),
    toggleSyncMenu: show({ menu: ui.menu === 'sync' ? null : 'sync' }),
  }

  const commit: CommitActions = {
    editSubject: value => void setDraft($, d => ({ ...d, subject: value })),
    removeBody: () => void setDraft($, d => ({ ...d, body: '' })),
    generate: act('Writing a message…', () => generate($, settings)),
    commit: act('Committing…', () => commitWithNotice($)),
    toggleMenu: show({ menu: ui.menu === 'commit' ? null : 'commit' }),
    commitAndPush: act('Committing and pushing…', () => commitAndPush($)),
    nothingToCommit: tell(NOTHING_TO_COMMIT),
  }

  const changes: ChangesActions = {
    toggle,
    ask,
    cancel,
    stage: file => act('Staging…', () => stageFile($, file)),
    unstage: file => act('Unstaging…', () => unstageFile($, file)),
    discard: file => act('Discarding…', () => discardFile($, file)),
    stageAll: act('Staging…', () => stageAll($)),
    unstageAll: act('Unstaging…', () => unstageAll($)),
    discardAll: act('Discarding…', () => discardAll($)),
  }

  const stashes: StashActions = {
    toggle: toggle('stashes'),
    apply: one => act('Applying the stash…', () => restoreStash($, one.ref, false)),
    pop: one => act('Restoring the stash…', () => restoreStash($, one.ref, true)),
    askDrop: one => ask(`stash:${one.index}`),
    drop: one => act('Dropping the stash…', () => dropStash($, one.ref)),
    cancel,
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
    openPrompt: prompt => show({ prompt, confirm: null }),
    tell,
    restoreLatest: (ref, pop) => act(pop ? 'Restoring the stash…' : 'Applying the stash…', () => restoreStash($, ref, pop)),
    amend: act('Amending…', () => amend($)),
    askUndo: ask('undo'),
    undo: act('Undoing…', () => undoLastCommit($)),
    cancel,
    commitAndSync: act('Committing and syncing…', () => commitAndSync($)),
    pullRebase: act('Pulling with rebase…', () => pullRebase($)),
    fetchPrune: act('Fetching…', () => fetchPrune($)),
    pickChoice: value => {
      if (value === 'more') {
        void setNotice($, 'error', 'Only the most recent branches fit here: switch to the one you want first, then use Create….')
        return
      }
      void editPrompt($, { choice: value })
    },
    editText: value => void editPrompt($, { text: value }),
    submit: submitPrompt,
    closePrompt: show({ prompt: null }),
  }

  return (
    <Box flexDirection="column" gap="md">
      <Header kit={kit} isRepo actions={header} />
      <StatusLine kit={kit} busy={busy} notice={notice} />
      <MoreMenu
        kit={kit}
        repo={repo}
        group={ui.more}
        prompt={ui.prompt}
        confirm={ui.confirm}
        hasChanges={hasChanges}
        actions={more}
      />
      <BranchSection
        kit={kit}
        repo={repo}
        filter={typeof ui.branchFilter === 'string' ? ui.branchFilter : null}
        isSyncMenuOpen={ui.menu === 'sync'}
        actions={branch}
      />
      <CommitSection
        kit={kit}
        draft={draft}
        stagedCount={repo.staged.length}
        hasChanges={hasChanges}
        isMenuOpen={ui.menu === 'commit'}
        actions={commit}
      />
      {hasChanges ? (
        <Changes
          kit={kit}
          staged={repo.staged}
          unstaged={repo.unstaged}
          collapsed={ui.collapsed}
          confirm={ui.confirm}
          revealOnHover={revealOnHover}
          actions={changes}
        />
      ) : (
        <CleanState kit={kit} isOutOfSync={isOutOfSync} />
      )}
      <Stashes
        kit={kit}
        stashes={repo.stashes}
        isOpen={isOpen('stashes')}
        confirm={ui.confirm}
        revealOnHover={revealOnHover}
        actions={stashes}
      />
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
