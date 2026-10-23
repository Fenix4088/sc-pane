import type { EngineInterface, RenderSurface } from 'claude-code'

import type { FileChange, GraphCommit, Repo } from '../../types'
import { GRAPH_PAGE } from '../constants'
import { failure, git, gitOrThrow, isConflict, userEmail } from '../git'
import { graphArgs } from '../helpers/branches'
import { parseGraph, parseNameStatus, parseNumstat, withCounts } from '../helpers/parse'
import { readGraphState, refresh, requireRepo, setGraph, setNotice, storedRepo } from '../store'
import { createBranch } from './branch'

export async function refreshGraph($: EngineInterface) {
  const repo = (await storedRepo($)) ?? (await refresh($))
  if (!repo) return

  const graph = await readGraphState($)
  const me = await userEmail($, repo.root)
  const log = await gitOrThrow($, graphArgs(repo, graph.scope, graph.pageSize), { cwd: repo.root })

  const rows = parseGraph(log.stdout, me)
  const hasMore = rows.filter(row => row.commit).length >= graph.pageSize
  if (JSON.stringify(rows) !== JSON.stringify(graph.rows) || hasMore !== graph.hasMore) {
    await setGraph($, { rows, hasMore })
  }
}

export async function setGraphScope($: EngineInterface, scope: string) {
  await setGraph($, { scope, pageSize: GRAPH_PAGE, selected: null, files: null })
  await refreshGraph($)
}

export async function loadMoreGraph($: EngineInterface) {
  const graph = await readGraphState($)
  await setGraph($, { pageSize: graph.pageSize + GRAPH_PAGE })
  await refreshGraph($)
}

// Changed files of one commit against its first parent, as VS Code lists them; the root commit against nothing.
async function readCommitFiles($: EngineInterface, repo: Repo, commit: GraphCommit): Promise<FileChange[]> {
  const cwd = repo.root
  const parent = commit.parents[0]
  const range = parent ? ['diff', parent, commit.hash] : ['diff-tree', '--root', '--no-commit-id', '-r', commit.hash]
  const [names, counts] = await Promise.all([
    git($, [...range.slice(0, 1), '--name-status', '-z', ...range.slice(1)], { cwd }),
    git($, [...range.slice(0, 1), '--numstat', '-z', ...range.slice(1)], { cwd }),
  ])
  if (names.exitCode !== 0) throw new Error(failure(names))

  return withCounts(parseNameStatus(names.stdout), parseNumstat(counts.stdout))
}

// Opens a commit's panel, or closes it when it is already open.
export async function selectCommit($: EngineInterface, hash: string) {
  const graph = await readGraphState($)
  if (graph.selected === hash) {
    await setGraph($, { selected: null, files: null, naming: null, confirm: null, copied: null })
    return
  }

  await setGraph($, { selected: hash, files: null, naming: null, confirm: null, copied: null })
  const commit = graph.rows.find(row => row.commit?.hash === hash)?.commit
  const repo = await requireRepo($)
  if (!commit) return

  const files = await readCommitFiles($, repo, commit)
  if ((await readGraphState($)).selected === hash) await setGraph($, { files })
}

// A commit action changes the branch, so both tabs read again after it (FR-GR-10).
async function afterGraphAction($: EngineInterface, text: string) {
  await setGraph($, { confirm: null, naming: null })
  await setNotice($, 'ok', text)
  await refresh($)
  await refreshGraph($)
}

export async function cherryPick($: EngineInterface, commit: GraphCommit) {
  const repo = await requireRepo($)
  const merge = commit.parents.length > 1 ? ['-m', '1'] : []
  const picked = await git($, ['cherry-pick', ...merge, commit.hash], { cwd: repo.root })
  if (picked.exitCode !== 0) {
    await refresh($)
    if (isConflict(picked)) {
      throw new Error(`Cherry-picking ${commit.hash} stopped on conflicts: resolve the files marked !, stage them, then commit.`)
    }
    throw new Error(failure(picked))
  }

  await afterGraphAction($, `Cherry-picked ${commit.hash} onto ${repo.branch}.`)
}

export async function revertCommit($: EngineInterface, commit: GraphCommit) {
  const repo = await requireRepo($)
  const merge = commit.parents.length > 1 ? ['-m', '1'] : []
  const reverted = await git($, ['revert', '--no-edit', ...merge, commit.hash], { cwd: repo.root })
  if (reverted.exitCode !== 0) {
    await refresh($)
    if (isConflict(reverted)) {
      throw new Error(`Reverting ${commit.hash} stopped on conflicts: resolve the files marked !, stage them, then commit.`)
    }
    throw new Error(failure(reverted))
  }

  await afterGraphAction($, `Reverted ${commit.hash} with a new commit on ${repo.branch}.`)
}

export async function checkoutDetached($: EngineInterface, commit: GraphCommit) {
  const repo = await requireRepo($)
  await gitOrThrow($, ['switch', '--detach', commit.hash], { cwd: repo.root })

  await afterGraphAction($, `Checked out ${commit.hash} with no branch: create a branch before committing here.`)
}

export async function branchAtCommit($: EngineInterface, commit: GraphCommit, name: string) {
  await createBranch($, name, commit.hash)
  await afterGraphAction($, `Created ${name.trim()} at ${commit.hash}, and switched to it.`)
}

export async function copyHash($: EngineInterface, commit: GraphCommit, surface: RenderSurface) {
  const repo = await storedRepo($)
  const full = (repo && (await git($, ['rev-parse', commit.hash], { cwd: repo.root })).stdout.trim()) || commit.hash
  const copied = await $.ui.copy({ text: full, surface })
  // The button itself says Copied; only a failure needs the status line.
  if (copied.isCopied) await setGraph($, { copied: commit.hash })
  else await setNotice($, 'error', 'Could not reach the clipboard.')
}
