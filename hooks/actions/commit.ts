import type { EngineInterface } from 'claude-code'

import type { Draft, LastCommit, Repo } from '../../types'
import { git, gitOrThrow } from '../git'
import { lastLines } from '../helpers/text'
import { readDraft, refresh, requireRepo, setDraft, setNotice } from '../store'
import { pushOnce, syncOnce } from './remote'

const EMPTY_DRAFT: Draft = { subject: '', body: '' }

// The message git receives on stdin, or null when the box is empty.
function messageOf(draft: Draft): string | null {
  const subject = draft.subject.trim()
  const body = draft.body.trim()
  if (!subject) return null

  return body ? `${subject}\n\n${body}\n` : `${subject}\n`
}

// The engine runs git with repo hooks off, so a husky commit-msg hook never fires
// from this pane. Where the repo has commitlint installed, run it ourselves (FR-COM-6).
async function commitlint($: EngineInterface, root: string, message: string): Promise<string | null> {
  const cli = `${root}/node_modules/@commitlint/cli/cli.js`
  if (!(await $.fs.exists(cli))) return null

  try {
    const result = await $.process.run(['node', cli], { cwd: root, stdin: message, timeoutMs: 30_000 })
    if (result.exitCode === 0) return null

    const problems = result.stdout
      .split(/\r?\n/)
      .filter(line => line.startsWith('✖') && !/found \d+ problems/.test(line))
      .map(line => line.replace(/^✖\s*/, ''))

    return `commitlint: ${problems.join('; ') || lastLines(result.stdout || result.stderr, 4)}`
  } catch {
    return null // node missing or commitlint broken: commit as git would without the hook
  }
}

// `auto` commits what is staged, or everything when nothing is; `staged` and `all` are the commit menu's
// Commit staged and Commit all (FR-COM-4).
export type CommitMode = 'auto' | 'staged' | 'all'

export async function commit($: EngineInterface, mode: CommitMode = 'auto'): Promise<string> {
  const draft = await readDraft($)
  const message = messageOf(draft)
  if (!message) throw new Error('Write a message or press Generate first.')

  const repo = await requireRepo($)
  if (repo.conflicts > 0) throw new Error('Resolve the merge conflicts first.')
  if (repo.staged.length === 0 && repo.unstaged.length === 0) throw new Error('Nothing to commit.')
  if (mode === 'staged' && repo.staged.length === 0) throw new Error('Nothing is staged: stage files with +, or use Commit all.')

  const lint = await commitlint($, repo.root, message)
  if (lint) throw new Error(lint)

  const cwd = repo.root
  const stagesAll = mode === 'all' ? repo.unstaged.length > 0 : mode === 'auto' && repo.staged.length === 0
  if (stagesAll) await gitOrThrow($, ['add', '-A'], { cwd })
  await gitOrThrow($, ['commit', '-F', '-'], { cwd, stdin: message })

  const sha = (await git($, ['rev-parse', '--short', 'HEAD'], { cwd })).stdout.trim()
  await setDraft($, () => EMPTY_DRAFT)
  await refresh($)

  return `Committed ${sha}: ${draft.subject.trim()}`
}

export async function commitWithNotice($: EngineInterface, mode: CommitMode = 'auto') {
  await setNotice($, 'ok', await commit($, mode))
}

export async function commitAndPush($: EngineInterface) {
  const committed = await commit($)
  const pushed = await pushOnce($, await requireRepo($))
  await setNotice($, 'ok', `${committed}. ${pushed}`)
  await refresh($)
}

export async function commitAndSync($: EngineInterface) {
  const committed = await commit($)
  await setNotice($, 'ok', `${committed}. ${await syncOnce($)}`)
  await refresh($)
}

// Amend and undo rewrite the last commit, so both refuse once a remote holds it (BR-2).
function unpushedLastCommit(repo: Repo, verb: string): LastCommit {
  if (!repo.lastCommit) throw new Error(`There is no commit to ${verb} yet.`)
  if (repo.lastCommit.isPushed) {
    throw new Error(`${repo.lastCommit.hash} is already pushed: ${verb === 'amend' ? 'amending' : 'undoing'} it would rewrite shared history.`)
  }

  return repo.lastCommit
}

// With a message in the box it replaces the last commit's message; empty, it keeps it and only adds what is staged.
export async function amend($: EngineInterface) {
  const repo = await requireRepo($)
  const last = unpushedLastCommit(repo, 'amend')
  const draft = await readDraft($)
  const message = messageOf(draft)

  if (message) {
    const lint = await commitlint($, repo.root, message)
    if (lint) throw new Error(lint)
  }

  const args = message ? ['commit', '--amend', '-F', '-'] : ['commit', '--amend', '--no-edit']
  await gitOrThrow($, args, { cwd: repo.root, stdin: message ?? undefined })

  if (message) await setDraft($, () => EMPTY_DRAFT)
  await setNotice($, 'ok', `Amended ${last.hash}${message ? `: ${draft.subject.trim()}` : ''}.`)
  await refresh($)
}

// Keeps the undone commit's changes staged and puts its message back in the box.
export async function undoLastCommit($: EngineInterface) {
  const repo = await requireRepo($)
  const last = unpushedLastCommit(repo, 'undo')

  await gitOrThrow($, ['reset', '--soft', 'HEAD~1'], { cwd: repo.root })

  await setDraft($, draft => (draft.subject.trim() ? draft : { subject: last.subject, body: '' }))
  await setNotice($, 'ok', `Undid ${last.hash}: its changes are staged again.`)
  await refresh($)
}
