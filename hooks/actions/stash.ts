import type { EngineInterface } from 'claude-code'

import { failure, git, gitOrThrow, isConflict } from '../git'
import { refresh, requireRepo, setNotice } from '../store'
import type { StashMode } from '../types'
import { gitAction } from './files'

export async function stash($: EngineInterface, mode: StashMode, message: string) {
  const repo = await requireRepo($)
  const tracked = repo.staged.length + repo.unstaged.filter(file => file.code !== 'U').length
  const untracked = repo.unstaged.filter(file => file.code === 'U').length
  if (mode === 'staged' && repo.staged.length === 0) throw new Error('Nothing is staged to stash.')
  if (mode === 'tracked' && tracked === 0) {
    throw new Error(untracked > 0 ? 'Only new files changed: use Stash incl. untracked.' : 'Nothing to stash.')
  }
  if (mode === 'untracked' && tracked + untracked === 0) throw new Error('Nothing to stash.')

  const flags = mode === 'untracked' ? ['--include-untracked'] : mode === 'staged' ? ['--staged'] : []
  const named = message.trim() ? ['-m', message.trim()] : []
  await gitOrThrow($, ['stash', 'push', ...flags, ...named], { cwd: repo.root })

  await setNotice($, 'ok', `Stashed ${mode === 'staged' ? 'the staged changes' : 'your changes'}${message.trim() ? ` as “${message.trim()}”` : ''}.`)
  await refresh($)
}

// Apply keeps the stash; pop removes it, unless the restore hits a conflict, when git keeps it too.
export async function restoreStash($: EngineInterface, ref: string, pop: boolean) {
  const repo = await requireRepo($)
  const restored = await git($, ['stash', pop ? 'pop' : 'apply', ref], { cwd: repo.root })
  await refresh($)
  if (restored.exitCode !== 0) {
    if (isConflict(restored)) {
      throw new Error(`${ref} restored with conflicts: resolve the files marked !. The stash was kept.`)
    }
    throw new Error(failure(restored))
  }

  await setNotice($, 'ok', pop ? `Restored and removed ${ref}.` : `Applied ${ref}; it stays in the list.`)
}

export async function dropStash($: EngineInterface, ref: string) {
  await gitAction($, ['stash', 'drop', ref])
  await setNotice($, 'ok', `Dropped ${ref}.`)
}
