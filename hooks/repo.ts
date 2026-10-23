import type { EngineInterface } from 'claude-code'

import type { Commit, LastCommit, Repo } from '../types'
import { COMMIT_FORMAT, COMMIT_LIMIT, STASH_FORMAT } from './constants'
import { failure, git, userEmail } from './git'
import { parseBranches, parseCommits, parseNumstat, parseStashes, parseStatus, withCounts } from './helpers/parse'

// One full read of the repository (FR-READ-*), or null outside a git repository.
export async function readRepo($: EngineInterface): Promise<Repo | null> {
  const top = await git($, ['rev-parse', '--show-toplevel'])
  if (top.exitCode !== 0) return null

  const root = top.stdout.trim()
  const cwd = root
  const status = await git($, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'], { cwd })
  if (status.exitCode !== 0) throw new Error(failure(status))

  const parsed = parseStatus(status.stdout)
  const [refs, worktree, index, stashes, originHead, head, pushedTo] = await Promise.all([
    git($, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)', 'refs/heads', 'refs/remotes'], { cwd }),
    git($, ['diff', '--numstat', '-z'], { cwd }),
    git($, ['diff', '--cached', '--numstat', '-z'], { cwd }),
    git($, ['stash', 'list', `--format=${STASH_FORMAT}`], { cwd }),
    git($, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd }),
    git($, ['log', '-1', '--format=%h%x1f%s'], { cwd }),
    git($, ['branch', '-r', '--contains', 'HEAD'], { cwd }),
  ])

  let lastCommit: LastCommit | null = null
  if (head.exitCode === 0 && head.stdout.trim()) {
    const [hash = '', subject = ''] = head.stdout.trim().split('\x1f')
    // When git cannot answer, count it as pushed: refusing an amend is safer than rewriting shared history.
    lastCommit = { hash, subject, isPushed: pushedTo.exitCode !== 0 || pushedTo.stdout.trim() !== '' }
  }
  const defaultBranch = originHead.exitCode === 0 ? originHead.stdout.trim().replace(/^origin\//, '') || null : null

  let incoming: Commit[] = []
  let outgoing: Commit[] = []
  if (parsed.upstream && (parsed.ahead > 0 || parsed.behind > 0)) {
    const me = await userEmail($, cwd)
    const log = (range: string) => git($, ['log', `--format=${COMMIT_FORMAT}`, '-n', String(COMMIT_LIMIT), range], { cwd })
    const [into, out] = await Promise.all([
      parsed.behind > 0 ? log('HEAD..@{u}') : null,
      parsed.ahead > 0 ? log('@{u}..HEAD') : null,
    ])
    incoming = into ? parseCommits(into.stdout, me) : []
    outgoing = out ? parseCommits(out.stdout, me) : []
  }

  return {
    root,
    ...parsed,
    staged: withCounts(parsed.staged, parseNumstat(index.stdout)),
    unstaged: withCounts(parsed.unstaged, parseNumstat(worktree.stdout)),
    branches: parseBranches(refs.stdout, parsed.branch),
    incoming,
    outgoing,
    stashes: stashes.exitCode === 0 ? parseStashes(stashes.stdout) : [],
    defaultBranch,
    lastCommit,
  }
}

// A value kept from an earlier version of the pane (state outlives a reload) is read as missing (NFR-8).
export function isCurrentRepo(repo: Repo | null): repo is Repo {
  return (
    repo !== null && Array.isArray(repo.incoming) && Array.isArray(repo.branches?.remote) && Array.isArray(repo.stashes)
  )
}
