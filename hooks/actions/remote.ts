import type { EngineInterface } from 'claude-code'

import type { Repo } from '../../types'
import { NETWORK_TIMEOUT } from '../constants'
import { git, gitOrThrow } from '../git'
import { lastLines, plural } from '../helpers/text'
import { refresh, requireRepo, setNotice } from '../store'

// The `…Once` functions do the work and return the notice text, so commit-and-push can chain them.
export async function pushOnce($: EngineInterface, repo: Repo): Promise<string> {
  const cwd = repo.root
  let args = ['push']
  let target = repo.upstream ?? ''
  if (!repo.upstream) {
    const remotes = (await git($, ['remote'], { cwd })).stdout.trim().split(/\r?\n/).filter(Boolean)
    const remote = remotes.includes('origin') ? 'origin' : remotes[0]
    if (!remote) throw new Error('No remote configured to push to.')
    args = ['push', '-u', remote, 'HEAD']
    target = `${remote}/${repo.branch}`
  }

  await gitOrThrow($, args, { cwd, timeoutMs: NETWORK_TIMEOUT })

  return `Pushed ${repo.branch} to ${target}.`
}

export async function pullOnce($: EngineInterface, repo: Repo, rebase = false): Promise<string> {
  const pulled = await gitOrThrow($, rebase ? ['pull', '--rebase'] : ['pull'], { cwd: repo.root, timeoutMs: NETWORK_TIMEOUT })

  return lastLines(pulled.stdout, 1) || (rebase ? 'Pulled and rebased.' : 'Pulled.')
}

// Pull first so the push is not refused, then push what is still ahead, as VS Code's Sync does.
export async function syncOnce($: EngineInterface): Promise<string> {
  let repo = await requireRepo($)
  if (!repo.upstream) return pushOnce($, repo)

  const pulled = repo.behind
  if (pulled > 0) {
    await pullOnce($, repo)
    repo = await requireRepo($)
  }
  const pushed = repo.ahead
  if (pushed > 0) await pushOnce($, repo)

  const done = [pulled > 0 ? `pulled ${plural(pulled, 'commit')}` : null, pushed > 0 ? `pushed ${pushed}` : null]
    .filter(Boolean)
    .join(', then ')

  return done ? `Synced: ${done}.` : 'Already in sync.'
}

export async function push($: EngineInterface) {
  await setNotice($, 'ok', await pushOnce($, await requireRepo($)))
  await refresh($)
}

export async function pull($: EngineInterface) {
  await setNotice($, 'ok', await pullOnce($, await requireRepo($)))
  await refresh($)
}

export async function pullRebase($: EngineInterface) {
  await setNotice($, 'ok', await pullOnce($, await requireRepo($), true))
  await refresh($)
}

export async function sync($: EngineInterface) {
  await setNotice($, 'ok', await syncOnce($))
  await refresh($)
}

export async function fetchAll($: EngineInterface) {
  const repo = await requireRepo($)
  await gitOrThrow($, ['fetch', '--all', '--prune'], { cwd: repo.root, timeoutMs: NETWORK_TIMEOUT })

  await setNotice($, 'ok', 'Fetched from all remotes.')
  await refresh($)
}

export async function fetchPrune($: EngineInterface) {
  const repo = await requireRepo($)
  await gitOrThrow($, ['fetch', '--prune'], { cwd: repo.root, timeoutMs: NETWORK_TIMEOUT })

  await setNotice($, 'ok', 'Fetched, and removed remote branches that no longer exist.')
  await refresh($)
}
