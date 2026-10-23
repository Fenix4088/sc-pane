// Parsers for git's output. Pure: text in, values out, no `$`.
import type { Branches, Commit, Draft, FileChange, GraphCommit, GraphRow, Stash } from '../../types'
import { BRANCH_LIMIT } from '../constants'
import type { LineCounts, Status } from '../types'
import { printable } from './text'

export function parseStatus(output: string): Status {
  const fields = output.split('\0')
  const status: Status = {
    branch: '',
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    conflicts: 0,
  }

  const add = (xy: string, path: string) => {
    const [x = '.', y = '.'] = xy
    if (x !== '.') status.staged.push({ path, code: x })
    if (y !== '.') status.unstaged.push({ path, code: y })
  }

  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i]
    if (!field) continue

    if (field.startsWith('# branch.head ')) {
      const head = field.slice('# branch.head '.length)
      status.branch = head === '(detached)' ? 'detached HEAD' : head
    } else if (field.startsWith('# branch.upstream ')) {
      status.upstream = field.slice('# branch.upstream '.length)
    } else if (field.startsWith('# branch.ab ')) {
      const match = /\+(\d+) -(\d+)/.exec(field)
      status.ahead = Number(match?.[1] ?? 0)
      status.behind = Number(match?.[2] ?? 0)
    } else if (field.startsWith('1 ')) {
      const parts = field.split(' ')
      add(parts[1] ?? '..', parts.slice(8).join(' '))
    } else if (field.startsWith('2 ')) {
      const parts = field.split(' ')
      add(parts[1] ?? '..', parts.slice(9).join(' '))
      i += 1 // the original path of a rename follows as its own field
    } else if (field.startsWith('u ')) {
      const parts = field.split(' ')
      status.unstaged.push({ path: parts.slice(10).join(' '), code: '!' })
      status.conflicts += 1
    } else if (field.startsWith('? ')) {
      status.unstaged.push({ path: field.slice(2), code: 'U' })
    }
  }

  return status
}

// `git diff --numstat -z`: `added\tremoved\tpath\0`, a rename as `added\tremoved\t\0from\0to\0`, binary as `-\t-`.
export function parseNumstat(output: string): Map<string, LineCounts> {
  const counts = new Map<string, LineCounts>()
  const fields = output.split('\0')

  for (let i = 0; i < fields.length; i += 1) {
    const parts = (fields[i] ?? '').split('\t')
    if (parts.length !== 3) continue

    const [added = '', removed = '', named = ''] = parts
    let path = named
    if (!path) {
      path = fields[i + 2] ?? ''
      i += 2
    }
    if (path && /^\d+$/.test(added) && /^\d+$/.test(removed)) {
      counts.set(path, { added: Number(added), removed: Number(removed) })
    }
  }

  return counts
}

export function withCounts(files: FileChange[], counts: Map<string, LineCounts>): FileChange[] {
  return files.map(file => ({ ...file, ...counts.get(file.path) }))
}

export function parseCommits(output: string, me: string): Commit[] {
  return output
    .split('\x1e')
    .map(record => record.trim())
    .filter(Boolean)
    .map(record => {
      const [hash = '', subject = '', name = '', email = '', when = ''] = record.split('\x1f')

      return {
        hash,
        subject: printable(subject),
        author: me && email.toLowerCase() === me ? 'you' : printable(name),
        when,
      }
    })
}

// `git stash list --format=STASH_FORMAT`; git writes the summary as `On <branch>: <message>`,
// or `WIP on <branch>: <hash> <subject>` for a stash made without a message.
export function parseStashes(output: string): Stash[] {
  return output
    .split('\x1e')
    .map(record => record.trim())
    .filter(Boolean)
    .map((record, position) => {
      const [ref = '', summary = '', when = ''] = record.split('\x1f')
      const match = /^(?:WIP on|On) ([^:]+): (.*)$/.exec(summary)
      const index = Number(/\{(\d+)\}/.exec(ref)?.[1] ?? position)

      return { index, ref, branch: match?.[1] ?? '', message: printable(match?.[2] ?? summary), when }
    })
}

export function parseMessage(text: string): Draft {
  const cleaned = text
    .trim()
    .replace(/^```[\w-]*\r?\n?/, '')
    .replace(/\r?\n?```$/, '')
    .trim()
  const [first = '', ...rest] = cleaned.split(/\r?\n/)
  const subject = first.trim().replace(/^["'`]+|["'`]+$/g, '')

  return { subject, body: rest.join('\n').trim() }
}

// `git for-each-ref --format=%(refname)` output, most recent commit first.
export function parseBranches(output: string, current: string): Branches {
  const local: string[] = []
  const remote: string[] = []

  for (const line of output.split(/\r?\n/)) {
    const ref = line.trim()
    if (ref.startsWith('refs/heads/')) {
      local.push(ref.slice('refs/heads/'.length))
    } else if (ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')) {
      remote.push(ref.slice('refs/remotes/'.length))
    }
  }

  const localNames = new Set(local)
  const remoteOnly = remote.filter(ref => !localNames.has(ref.slice(ref.indexOf('/') + 1)))

  // The checked-out branch leads the list, and is kept even before its first commit, when it has no ref.
  const listed =
    current && current !== 'detached HEAD' ? [current, ...local.filter(name => name !== current)] : local

  return { local: listed.slice(0, BRANCH_LIMIT), remote: remoteOnly.slice(0, BRANCH_LIMIT) }
}

// `git log --graph` lines: lane drawing alone (a connector), or lane drawing then the GRAPH_FORMAT record.
export function parseGraph(output: string, me: string): GraphRow[] {
  return output
    .split(/\r?\n/)
    .filter(line => line.trim() !== '')
    .map(line => {
      const at = line.indexOf('\x1f')
      if (at < 0) return { prefix: line.trimEnd() }

      const [hash = '', parents = '', refs = '', subject = '', name = '', email = '', when = ''] = line
        .slice(at + 1)
        .split('\x1f')
      const commit: GraphCommit = {
        hash,
        parents: parents.split(' ').filter(Boolean),
        refs: refs
          .split(', ')
          .map(ref => ref.trim().replace('HEAD -> ', 'HEAD → '))
          .filter(ref => ref && ref !== 'origin/HEAD'),
        subject: printable(subject),
        author: me && email.toLowerCase() === me ? 'you' : printable(name),
        when,
      }

      return { prefix: line.slice(0, at).trimEnd(), commit }
    })
}

// `git diff --name-status -z`: `M\0path\0`, a rename or copy as `R100\0from\0to\0`.
export function parseNameStatus(output: string): FileChange[] {
  const fields = output.split('\0')
  const files: FileChange[] = []
  for (let i = 0; i < fields.length; ) {
    const status = fields[i] ?? ''
    if (!status) {
      i += 1
      continue
    }
    const code = status[0] ?? 'M'
    const isMove = code === 'R' || code === 'C'
    files.push({ code, path: fields[i + (isMove ? 2 : 1)] ?? '' })
    i += isMove ? 3 : 2
  }

  return files
}
