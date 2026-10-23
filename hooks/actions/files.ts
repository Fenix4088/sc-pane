import type { EngineInterface } from 'claude-code'

import type { FileChange } from '../../types'
import { failure, git } from '../git'
import { plural } from '../helpers/text'
import { refresh, requireRepo, setNotice, storedRepo } from '../store'

// Runs one git command in the repository root, then reads the repository again.
export async function gitAction($: EngineInterface, args: string[]) {
  const repo = await storedRepo($)
  if (!repo) return

  const result = await git($, args, { cwd: repo.root })
  if (result.exitCode !== 0) throw new Error(failure(result))

  await refresh($)
}

export async function stageFile($: EngineInterface, file: FileChange) {
  await gitAction($, ['add', '--', file.path])
}

export async function unstageFile($: EngineInterface, file: FileChange) {
  await gitAction($, ['restore', '--staged', '--', file.path])
}

export async function stageAll($: EngineInterface) {
  await gitAction($, ['add', '-A'])
}

export async function unstageAll($: EngineInterface) {
  await gitAction($, ['reset', '-q'])
}

// Discarding cannot be undone: the pane only calls these after the person confirmed in the row.
export async function discardFile($: EngineInterface, file: FileChange) {
  const args = file.code === 'U' ? ['clean', '-f', '--', file.path] : ['restore', '--worktree', '--', file.path]
  await gitAction($, args)
  await setNotice($, 'ok', file.code === 'U' ? `Deleted ${file.path}.` : `Discarded changes to ${file.path}.`)
}

export async function discardAll($: EngineInterface) {
  const repo = await requireRepo($)
  const tracked = repo.unstaged.some(file => file.code !== 'U')
  const untracked = repo.unstaged.some(file => file.code === 'U')

  if (tracked) await gitAction($, ['restore', '--worktree', '--', '.'])
  if (untracked) await gitAction($, ['clean', '-fd'])
  await setNotice($, 'ok', `Discarded ${plural(repo.unstaged.length, 'change')}.`)
}
