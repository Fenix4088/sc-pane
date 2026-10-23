import { atom, read, update } from 'claude-code'
import type { EngineInterface, ProcessRunResult, Register } from 'claude-code'

import type {
  Branches,
  Commit,
  Draft,
  FileChange,
  GraphCommit,
  GraphRow,
  GraphState,
  LastCommit,
  MoreMenu,
  Notice,
  PaneUi,
  Prompt,
  Repo,
  Stash,
} from '../types'

const PANE = 'sc-pane'
const TITLE = 'Source Control'
const GRAPH_PANE = 'sc-pane-graph'
const GRAPH_TITLE = 'Graph'
const GRAPH_PAGE = 50

const repoState = atom({ plugin: 'sc-pane', key: 'repo' } as const, null)
const draftState = atom({ plugin: 'sc-pane', key: 'draft' } as const, { subject: '', body: '' })
const busyState = atom({ plugin: 'sc-pane', key: 'busy' } as const, null)
const noticeState = atom({ plugin: 'sc-pane', key: 'notice' } as const, null)
const uiState = atom({ plugin: 'sc-pane', key: 'ui' } as const, {
  collapsed: [],
  menu: null,
  confirm: null,
  branchFilter: null,
  more: null,
  prompt: null,
})
const GRAPH_START: GraphState = {
  scope: 'auto',
  pageSize: GRAPH_PAGE,
  rows: [],
  hasMore: false,
  selected: null,
  files: null,
  naming: null,
  confirm: null,
}
const graphState = atom({ plugin: 'sc-pane', key: 'graph' } as const, GRAPH_START)

// No terminal prompts (they would hang the call) and no editor for merge commits.
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_MERGE_AUTOEDIT: 'no' }
const NETWORK_TIMEOUT = 120_000
const DIFF_BUDGET = 40_000
const UNTRACKED_FILE_BUDGET = 4_000
const LIST_LIMIT = 50
const BRANCH_LIMIT = 200
const COMMIT_LIMIT = 20
// A Select takes 1 to 64 options, and a tree holding more is refused whole: the pane then draws nothing.
const SELECT_LIMIT = 64

// Fields split by unit separators, records by record separators, so subjects can hold anything.
const COMMIT_FORMAT = '%h%x1f%s%x1f%an%x1f%ae%x1f%cr%x1e'
const STASH_FORMAT = '%gd%x1f%gs%x1f%cr%x1e'
// After git's own lane drawing, so a line holding a commit carries a record after its first unit separator.
const GRAPH_FORMAT = '%x1f%h%x1f%p%x1f%D%x1f%s%x1f%an%x1f%ae%x1f%cr'

const COMMITLINT_CONFIGS = [
  'commitlint.config.ts',
  'commitlint.config.js',
  'commitlint.config.cjs',
  'commitlint.config.mjs',
  '.commitlintrc',
  '.commitlintrc.json',
  '.commitlintrc.yml',
  '.commitlintrc.yaml',
  '.commitlintrc.js',
  '.commitlintrc.cjs',
]

// Fixed tones for the SVG icons (an image cannot follow the theme); each reads on light and dark grounds.
const TONE = { muted: '#8B9099', green: '#3FA866', amber: '#D9962B', blue: '#5B8DEF' }

const ICON = {
  branch:
    '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
}

function svg(paths: string, stroke: string, size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
}

function dot(fill: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3.5" fill="${fill}"/></svg>`
}

const CLEAN_BADGE = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="22" fill="${TONE.green}" fill-opacity="0.16"/><path d="M31 16 19 28l-6-6" fill="none" stroke="${TONE.green}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`

type Settings = { model: string; includeBody: boolean }

type RunInit = { cwd?: string; stdin?: string; timeoutMs?: number }

function git($: EngineInterface, args: string[], init: RunInit = {}): Promise<ProcessRunResult> {
  return $.process.run(['git', ...args], { env: GIT_ENV, ...init })
}

function lastLines(text: string, count: number): string {
  return text.trim().split(/\r?\n/).slice(-count).join('\n')
}

function failure(result: ProcessRunResult): string {
  const text = lastLines(result.stderr || result.stdout, 8)

  return text || `git exited with code ${result.exitCode}`
}

// A label holding a control character (a tab in a subject, say) is refused, and with it the whole pane.
export function printable(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

type Status = Omit<Repo, 'root' | 'branches' | 'incoming' | 'outgoing' | 'stashes' | 'defaultBranch' | 'lastCommit'>

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
export function parseNumstat(output: string): Map<string, { added: number; removed: number }> {
  const counts = new Map<string, { added: number; removed: number }>()
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

function withCounts(files: FileChange[], counts: Map<string, { added: number; removed: number }>): FileChange[] {
  return files.map(file => ({ ...file, ...counts.get(file.path) }))
}

function sameRepo(a: Repo | null, b: Repo | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

async function readRepo($: EngineInterface): Promise<Repo | null> {
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
    const me = (await git($, ['config', 'user.email'], { cwd })).stdout.trim().toLowerCase()
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

async function refresh($: EngineInterface): Promise<Repo | null> {
  const next = await readRepo($)

  // Write only on a change, so the periodic refresh does not redraw a pane mid-typing.
  if (!sameRepo(await read($, repoState), next)) {
    await update($, repoState, () => next)
  }

  return next
}

async function requireRepo($: EngineInterface): Promise<Repo> {
  const repo = await refresh($)
  if (!repo) throw new Error('Not a git repository.')

  return repo
}

async function setNotice($: EngineInterface, kind: Notice['kind'], text: string) {
  await update($, noticeState, () => ({ kind, text }))
}

async function setUi($: EngineInterface, change: Partial<PaneUi>) {
  await update($, uiState, ui => ({ ...ui, ...change }))
}

async function run($: EngineInterface, label: string, action: () => Promise<void>) {
  if ((await read($, busyState)) !== null) return

  await update($, busyState, () => label)
  await update($, noticeState, () => null)
  await setUi($, { menu: null, confirm: null, more: null, prompt: null })
  try {
    await action()
  } catch (error) {
    await setNotice($, 'error', error instanceof Error ? error.message : String(error))
  } finally {
    await update($, busyState, () => null)
  }
}

async function commitRules($: EngineInterface, root: string): Promise<string | null> {
  for (const name of COMMITLINT_CONFIGS) {
    const path = `${root}/${name}`
    if (await $.fs.exists(path)) {
      const text = await $.fs.read(path)

      return `${name}:\n${text.slice(0, 4_000)}`
    }
  }

  return null
}

// The engine runs git with repo hooks off, so a husky commit-msg hook never fires
// from this pane. Where the repo has commitlint installed, run it ourselves.
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

async function generate($: EngineInterface, settings: Settings) {
  const repo = await requireRepo($)

  const useStaged = repo.staged.length > 0
  if (!useStaged && repo.unstaged.length === 0) throw new Error('No changes to describe.')

  const cwd = repo.root
  const scope = useStaged ? ['--cached'] : []
  const stat = await git($, ['diff', ...scope, '--stat', '--no-color'], { cwd })
  const diff = await git($, ['diff', ...scope, '--no-color', '--no-ext-diff', '-U3'], { cwd })
  if (diff.exitCode !== 0) throw new Error(failure(diff))

  let budget = DIFF_BUDGET
  let diffText = diff.stdout
  if (diffText.length > budget) {
    diffText = `${diffText.slice(0, budget)}\n[diff cut at ${budget} characters]`
  }
  budget -= diffText.length

  const untracked = useStaged ? [] : repo.unstaged.filter(file => file.code === 'U')
  const newFiles: string[] = []
  for (const file of untracked) {
    if (budget <= 0) {
      newFiles.push(`${file.path} (content not shown)`)
      continue
    }
    try {
      const text = (await $.fs.read(`${cwd}/${file.path}`)).slice(0, Math.min(UNTRACKED_FILE_BUDGET, budget))
      budget -= text.length
      newFiles.push(`--- new file: ${file.path}\n${text}`)
    } catch {
      newFiles.push(`${file.path} (binary or unreadable)`)
    }
  }

  const log = await git($, ['log', '-n', '15', '--format=%s'], { cwd })
  const recent = log.exitCode === 0 ? log.stdout.trim() : ''
  const rules = await commitRules($, cwd)

  const system = [
    'You write git commit messages. Reply with the commit message only: no preamble, no quotes, no code fences.',
    'First line: a subject of at most 72 characters in the imperative mood, describing what the change does.',
    settings.includeBody
      ? 'When the change is more than a one-liner, add a blank line and a short body (wrapped at 72 characters) saying what changed and why. Use "-" bullets for several distinct changes. Skip the body for trivial changes.'
      : 'Write the subject line only, no body.',
    'Follow the repository convention shown by its recent commit subjects and its commitlint config when one is given: same type prefixes, scopes and casing. When a scope is required, pick the area most of the change touches.',
  ].join('\n')

  const prompt = [
    rules ? `Commit lint rules (${rules})` : null,
    recent ? `Recent commit subjects:\n${recent}` : null,
    `Changes to describe (${useStaged ? 'staged' : 'working tree'}):\n${stat.stdout.trim()}`,
    diffText.trim() ? `Diff:\n${diffText}` : null,
    newFiles.length > 0 ? `New untracked files:\n${newFiles.join('\n\n')}` : null,
  ]
    .filter(part => part !== null)
    .join('\n\n')

  const reply = await $.model.complete({
    model: settings.model,
    system,
    prompt,
    maxTokens: 800,
    effort: 'low',
    timeoutMs: 90_000,
  })
  if (!reply.isAnswered) {
    throw new Error(
      reply.reason === 'api-error'
        ? `The model call failed (${reply.error}${reply.status ? `, HTTP ${reply.status}` : ''}).`
        : `The model gave no message (${reply.reason}).`,
    )
  }

  const draft = parseMessage(reply.text)
  if (!draft.subject) throw new Error('The model returned an empty message.')

  await update($, draftState, () => draft)
  await setNotice($, 'ok', `Message written from the ${useStaged ? 'staged' : 'working tree'} changes.`)
}

async function commit($: EngineInterface): Promise<string> {
  const draft = await read($, draftState)
  const subject = draft.subject.trim()
  if (!subject) throw new Error('Write a message or press Generate first.')

  const body = draft.body.trim()
  const message = body ? `${subject}\n\n${body}\n` : `${subject}\n`

  const repo = await requireRepo($)
  if (repo.conflicts > 0) throw new Error('Resolve the merge conflicts first.')
  if (repo.staged.length === 0 && repo.unstaged.length === 0) throw new Error('Nothing to commit.')

  const lint = await commitlint($, repo.root, message)
  if (lint) throw new Error(lint)

  const cwd = repo.root
  if (repo.staged.length === 0) {
    const added = await git($, ['add', '-A'], { cwd })
    if (added.exitCode !== 0) throw new Error(failure(added))
  }

  const committed = await git($, ['commit', '-F', '-'], { cwd, stdin: message })
  if (committed.exitCode !== 0) throw new Error(failure(committed))

  const sha = (await git($, ['rev-parse', '--short', 'HEAD'], { cwd })).stdout.trim()
  await update($, draftState, () => ({ subject: '', body: '' }))
  await refresh($)

  return `Committed ${sha}: ${subject}`
}

async function pushOnce($: EngineInterface, repo: Repo): Promise<string> {
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

  const pushed = await git($, args, { cwd, timeoutMs: NETWORK_TIMEOUT })
  if (pushed.exitCode !== 0) throw new Error(failure(pushed))

  return `Pushed ${repo.branch} to ${target}.`
}

async function pullOnce($: EngineInterface, repo: Repo, rebase = false): Promise<string> {
  const pulled = await git($, rebase ? ['pull', '--rebase'] : ['pull'], { cwd: repo.root, timeoutMs: NETWORK_TIMEOUT })
  if (pulled.exitCode !== 0) throw new Error(failure(pulled))

  return lastLines(pulled.stdout, 1) || (rebase ? 'Pulled and rebased.' : 'Pulled.')
}

async function push($: EngineInterface) {
  await setNotice($, 'ok', await pushOnce($, await requireRepo($)))
  await refresh($)
}

async function pull($: EngineInterface) {
  await setNotice($, 'ok', await pullOnce($, await requireRepo($)))
  await refresh($)
}

// Pull first so the push is not refused, then push what is still ahead, as VS Code's Sync does.
async function syncOnce($: EngineInterface): Promise<string> {
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

async function sync($: EngineInterface) {
  await setNotice($, 'ok', await syncOnce($))
  await refresh($)
}

async function commitAndPush($: EngineInterface) {
  const committed = await commit($)
  const pushed = await pushOnce($, await requireRepo($))
  await setNotice($, 'ok', `${committed}. ${pushed}`)
  await refresh($)
}

async function commitAndSync($: EngineInterface) {
  const committed = await commit($)
  await setNotice($, 'ok', `${committed}. ${await syncOnce($)}`)
  await refresh($)
}

async function pullRebase($: EngineInterface) {
  await setNotice($, 'ok', await pullOnce($, await requireRepo($), true))
  await refresh($)
}

async function fetchPrune($: EngineInterface) {
  const repo = await requireRepo($)
  const fetched = await git($, ['fetch', '--prune'], { cwd: repo.root, timeoutMs: NETWORK_TIMEOUT })
  if (fetched.exitCode !== 0) throw new Error(failure(fetched))

  await setNotice($, 'ok', 'Fetched, and removed remote branches that no longer exist.')
  await refresh($)
}

// Amend and undo rewrite the last commit, so both refuse once a remote holds it.
function unpushedLastCommit(repo: Repo, verb: string): LastCommit {
  if (!repo.lastCommit) throw new Error(`There is no commit to ${verb} yet.`)
  if (repo.lastCommit.isPushed) {
    throw new Error(`${repo.lastCommit.hash} is already pushed: ${verb === 'amend' ? 'amending' : 'undoing'} it would rewrite shared history.`)
  }

  return repo.lastCommit
}

// With a message in the box it replaces the last commit's message; empty, it keeps it and only adds what is staged.
async function amend($: EngineInterface) {
  const repo = await requireRepo($)
  const last = unpushedLastCommit(repo, 'amend')
  const draft = await read($, draftState)
  const subject = draft.subject.trim()
  const body = draft.body.trim()
  const message = subject ? (body ? `${subject}\n\n${body}\n` : `${subject}\n`) : null

  if (message) {
    const lint = await commitlint($, repo.root, message)
    if (lint) throw new Error(lint)
  }

  const args = message ? ['commit', '--amend', '-F', '-'] : ['commit', '--amend', '--no-edit']
  const amended = await git($, args, { cwd: repo.root, stdin: message ?? undefined })
  if (amended.exitCode !== 0) throw new Error(failure(amended))

  if (message) await update($, draftState, () => ({ subject: '', body: '' }))
  await setNotice($, 'ok', `Amended ${last.hash}${message ? `: ${subject}` : ''}.`)
  await refresh($)
}

// Keeps the undone commit's changes staged and puts its message back in the box.
async function undoLastCommit($: EngineInterface) {
  const repo = await requireRepo($)
  const last = unpushedLastCommit(repo, 'undo')

  const reset = await git($, ['reset', '--soft', 'HEAD~1'], { cwd: repo.root })
  if (reset.exitCode !== 0) throw new Error(failure(reset))

  await update($, draftState, draft => (draft.subject.trim() ? draft : { subject: last.subject, body: '' }))
  await setNotice($, 'ok', `Undid ${last.hash}: its changes are staged again.`)
  await refresh($)
}

export type StashMode = 'tracked' | 'untracked' | 'staged'

async function stash($: EngineInterface, mode: StashMode, message: string) {
  const repo = await requireRepo($)
  const tracked = repo.staged.length + repo.unstaged.filter(file => file.code !== 'U').length
  const untracked = repo.unstaged.length - repo.unstaged.filter(file => file.code !== 'U').length
  if (mode === 'staged' && repo.staged.length === 0) throw new Error('Nothing is staged to stash.')
  if (mode === 'tracked' && tracked === 0) {
    throw new Error(untracked > 0 ? 'Only new files changed: use Stash incl. untracked.' : 'Nothing to stash.')
  }
  if (mode === 'untracked' && tracked + untracked === 0) throw new Error('Nothing to stash.')

  const flags = mode === 'untracked' ? ['--include-untracked'] : mode === 'staged' ? ['--staged'] : []
  const named = message.trim() ? ['-m', message.trim()] : []
  const stashed = await git($, ['stash', 'push', ...flags, ...named], { cwd: repo.root })
  if (stashed.exitCode !== 0) throw new Error(failure(stashed))

  await setNotice($, 'ok', `Stashed ${mode === 'staged' ? 'the staged changes' : 'your changes'}${message.trim() ? ` as “${message.trim()}”` : ''}.`)
  await refresh($)
}

// Apply keeps the stash; pop removes it, unless the restore hits a conflict, when git keeps it too.
async function restoreStash($: EngineInterface, ref: string, pop: boolean) {
  const repo = await requireRepo($)
  const restored = await git($, ['stash', pop ? 'pop' : 'apply', ref], { cwd: repo.root })
  await refresh($)
  if (restored.exitCode !== 0) {
    if (/CONFLICT/.test(restored.stdout + restored.stderr)) {
      throw new Error(`${ref} restored with conflicts: resolve the files marked !. The stash was kept.`)
    }
    throw new Error(failure(restored))
  }

  await setNotice($, 'ok', pop ? `Restored and removed ${ref}.` : `Applied ${ref}; it stays in the list.`)
}

async function dropStash($: EngineInterface, ref: string) {
  await gitAction($, ['stash', 'drop', ref])
  await setNotice($, 'ok', `Dropped ${ref}.`)
}

async function validBranchName($: EngineInterface, repo: Repo, name: string): Promise<string> {
  const wanted = name.trim()
  if (!wanted) throw new Error('Type a branch name first.')

  const checked = await git($, ['check-ref-format', '--branch', wanted], { cwd: repo.root })
  if (checked.exitCode !== 0) throw new Error(`“${wanted}” is not a valid branch name.`)
  if (repo.branches.local.includes(wanted)) throw new Error(`A branch named ${wanted} already exists.`)

  return wanted
}

// `base` is a picker value (`local:<name>`, `remote:<ref>`) or a commit hash; absent, the current HEAD.
async function createBranch($: EngineInterface, name: string, base?: string) {
  const repo = await requireRepo($)
  const branch = await validBranchName($, repo, name)
  const start = base?.replace(/^(local|remote):/, '')

  const created = await git($, ['switch', '-c', branch, ...(start ? [start] : [])], { cwd: repo.root })
  if (created.exitCode !== 0) throw new Error(failure(created))

  await setNotice($, 'ok', `Created ${branch}${start ? ` from ${start}` : ''}, and switched to it.`)
  await refresh($)
}

async function renameBranch($: EngineInterface, name: string) {
  const repo = await requireRepo($)
  if (repo.branch === 'detached HEAD') throw new Error('No branch is checked out to rename.')
  const branch = await validBranchName($, repo, name)

  const renamed = await git($, ['branch', '-m', branch], { cwd: repo.root })
  if (renamed.exitCode !== 0) throw new Error(failure(renamed))

  await setNotice($, 'ok', `Renamed ${repo.branch} to ${branch}.${repo.upstream ? ' Its upstream is unchanged.' : ''}`)
  await refresh($)
}

// `-d` first; when git says the branch is not merged, the pane asks again before `-D`.
async function deleteBranch($: EngineInterface, name: string, force: boolean) {
  const repo = await requireRepo($)
  const deleted = await git($, ['branch', force ? '-D' : '-d', name], { cwd: repo.root })
  if (deleted.exitCode !== 0) {
    if (!force && /not fully merged/.test(deleted.stderr)) {
      await setUi($, { more: 'branch', prompt: { kind: 'forceDelete', text: '', choice: name } })
      return
    }
    throw new Error(failure(deleted))
  }

  await setNotice($, 'ok', `Deleted ${name}.`)
  await refresh($)
}

async function mergeBranch($: EngineInterface, name: string) {
  const repo = await requireRepo($)
  const merged = await git($, ['merge', '--no-edit', name], { cwd: repo.root })
  await refresh($)
  if (merged.exitCode !== 0) {
    if (/CONFLICT/.test(merged.stdout + merged.stderr)) {
      throw new Error(`Merging ${name} stopped on conflicts: resolve the files marked !, stage them, then commit.`)
    }
    throw new Error(failure(merged))
  }

  await setNotice($, 'ok', lastLines(merged.stdout, 1) || `Merged ${name} into ${repo.branch}.`)
}

// Values of the branch picker: `local:<name>`, `remote:<remote>/<name>`, or `detached`.
async function switchBranch($: EngineInterface, value: string) {
  const repo = await requireRepo($)

  let args: string[]
  let done: string
  if (value.startsWith('local:')) {
    const name = value.slice('local:'.length)
    if (name === repo.branch) return
    args = ['switch', name]
    done = `Switched to ${name}.`
  } else if (value.startsWith('remote:')) {
    const ref = value.slice('remote:'.length)
    const name = ref.slice(ref.indexOf('/') + 1)
    // Picking a remote branch makes a local branch of the same name that tracks it, as VS Code does.
    args = repo.branches.local.includes(name) ? ['switch', name] : ['switch', '--track', ref]
    done = args.includes('--track') ? `Created ${name} tracking ${ref}, and switched to it.` : `Switched to ${name}.`
  } else {
    return
  }

  // Uncommitted changes come along; git refuses the switch when they would be overwritten.
  const switched = await git($, args, { cwd: repo.root })
  if (switched.exitCode !== 0) throw new Error(failure(switched))

  await setNotice($, 'ok', done)
  await refresh($)
}

async function fetchAll($: EngineInterface) {
  const repo = await requireRepo($)

  const fetched = await git($, ['fetch', '--all', '--prune'], { cwd: repo.root, timeoutMs: NETWORK_TIMEOUT })
  if (fetched.exitCode !== 0) throw new Error(failure(fetched))

  await setNotice($, 'ok', 'Fetched from all remotes.')
  await refresh($)
}

async function gitAction($: EngineInterface, args: string[]) {
  const repo = await read($, repoState)
  if (!repo) return

  const result = await git($, args, { cwd: repo.root })
  if (result.exitCode !== 0) throw new Error(failure(result))

  await refresh($)
}

// Discarding cannot be undone: the pane only calls these after the person confirmed in the row.
async function discardFile($: EngineInterface, file: FileChange) {
  const args = file.code === 'U' ? ['clean', '-f', '--', file.path] : ['restore', '--worktree', '--', file.path]
  await gitAction($, args)
  await setNotice($, 'ok', file.code === 'U' ? `Deleted ${file.path}.` : `Discarded changes to ${file.path}.`)
}

async function discardAll($: EngineInterface) {
  const repo = await requireRepo($)
  const tracked = repo.unstaged.some(file => file.code !== 'U')
  const untracked = repo.unstaged.some(file => file.code === 'U')

  if (tracked) await gitAction($, ['restore', '--worktree', '--', '.'])
  if (untracked) await gitAction($, ['clean', '-fd'])
  await setNotice($, 'ok', `Discarded ${plural(repo.unstaged.length, 'change')}.`)
}

function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: TITLE })
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

// One row of the drawn graph: the commit's column and the strokes through its row. `top` runs from the row's
// top edge to its middle, `bottom` from the middle down, `full` straight through; `lane` picks the colour.
export type LaneSegment = { from: number; to: number; half: 'top' | 'bottom' | 'full'; lane: number }
export type LaneRow = { hash: string; col: number; isMerge: boolean; segments: LaneSegment[]; width: number }

function freeSlot(slots: (string | null)[], taken: number): number {
  const free = slots.findIndex((slot, index) => slot === null && index !== taken)

  return free < 0 ? Math.max(slots.length, taken + 1) : free
}

// Assigns each commit a column from its parents, children first: each lane holds the hash it is waiting for.
export function layoutLanes(commits: GraphCommit[]): LaneRow[] {
  let waiting: (string | null)[] = []

  return commits.map(commit => {
    const before = [...waiting]
    let col = before.indexOf(commit.hash)
    if (col < 0) col = freeSlot(before, -1)

    const segments: LaneSegment[] = []
    before.forEach((hash, lane) => {
      if (hash === commit.hash) segments.push({ from: lane, to: col, half: 'top', lane })
    })

    const after = before.map(hash => (hash === commit.hash ? null : hash))
    while (after.length <= col) after.push(null)
    const [first, ...others] = commit.parents
    after[col] = first ?? null

    const merged = others.map(parent => {
      let lane = after.indexOf(parent)
      if (lane < 0) {
        lane = freeSlot(after, col)
        while (after.length <= lane) after.push(null)
        after[lane] = parent
      }
      return lane
    })

    before.forEach((hash, lane) => {
      if (hash !== null && hash !== commit.hash && after[lane] === hash) {
        segments.push({ from: lane, to: lane, half: 'full', lane })
      }
    })
    if (first) segments.push({ from: col, to: col, half: 'bottom', lane: col })
    merged.forEach(lane => segments.push({ from: col, to: lane, half: 'bottom', lane }))

    while (after.length > 0 && after[after.length - 1] === null) after.pop()
    waiting = after

    return { hash: commit.hash, col, isMerge: others.length > 0, segments, width: Math.max(before.length, after.length, col + 1) }
  })
}

export const MAX_LANES = 24
// Text colours set by value: each reads on light and dark grounds, and eight stay apart where the theme has fewer.
const LANE_TONES = ['#4C8DF6', '#E5A33B', '#3FB27F', '#D9608A', '#9B7BE0', '#2FB5C4', '#E07A4B', '#8AA0B4']

export function laneTone(lane: number): string {
  return LANE_TONES[lane % LANE_TONES.length] ?? '#8AA0B4'
}

// One lane's two characters in a row: the glyph on the lane, then the joint towards the next lane.
export type LaneCell = { glyph: string; glyphLane: number; joint: string; jointLane: number }

// The box-drawing glyph for a lane by which of its sides carry a line through the row's middle.
const GLYPHS: Record<string, string> = {
  '': ' ',
  u: '│',
  d: '│',
  ud: '│',
  l: '─',
  r: '─',
  lr: '─',
  ul: '╯',
  ur: '╰',
  dl: '╮',
  dr: '╭',
  udl: '┤',
  udr: '├',
  ulr: '┴',
  dlr: '┬',
  udlr: '┼',
}

// Draws a LaneRow as text, `lanes` wide so every row's message starts at the same column.
export function laneCells(row: LaneRow, lanes: number): LaneCell[] {
  const width = Math.min(lanes, MAX_LANES)
  const cells = Array.from({ length: width }, () => ({
    up: false,
    down: false,
    left: false,
    right: false,
    upright: -1,
    across: -1,
  }))
  const cell = (lane: number) => cells[lane]
  const vertical = (lane: number, lane2: number, side: 'up' | 'down') => {
    const at = cell(lane)
    if (!at) return
    at[side] = true
    if (at.upright < 0) at.upright = lane2
  }
  const horizontal = (from: number, to: number, lane: number) => {
    const low = Math.min(from, to)
    const high = Math.min(Math.max(from, to), width - 1)
    for (let index = low; index <= high; index += 1) {
      const at = cell(index)
      if (!at) continue
      if (index > low) at.left = true
      if (index < high) at.right = true
      if (at.across < 0) at.across = lane
    }
  }

  for (const segment of row.segments) {
    if (segment.half === 'full') {
      vertical(segment.from, segment.lane, 'up')
      vertical(segment.from, segment.lane, 'down')
    } else if (segment.half === 'top') {
      vertical(segment.from, segment.lane, 'up')
      if (segment.from !== segment.to) horizontal(segment.from, segment.to, segment.lane)
    } else {
      vertical(segment.to, segment.lane, 'down')
      if (segment.from !== segment.to) horizontal(segment.from, segment.to, segment.lane)
    }
  }

  return cells.map((at, lane) => {
    const key = `${at.up ? 'u' : ''}${at.down ? 'd' : ''}${at.left ? 'l' : ''}${at.right ? 'r' : ''}`
    const glyph = lane === row.col ? (row.isMerge ? '○' : '●') : (GLYPHS[key] ?? ' ')
    const glyphLane = lane === row.col ? row.col : at.upright >= 0 ? at.upright : at.across

    return { glyph, glyphLane: Math.max(glyphLane, 0), joint: at.right ? '─' : ' ', jointLane: Math.max(at.across, 0) }
  })
}

// Commit subjects are cut to this many characters so the lanes keep their room; the full text shows on hover.
export const SUBJECT_CHARS = 60

export function shortSubject(subject: string): string {
  return subject.length > SUBJECT_CHARS ? `${subject.slice(0, SUBJECT_CHARS - 1).trimEnd()}…` : subject
}

// The refs the graph walks: HEAD, its upstream and the default branch, or every branch, or auto plus one picked.
export function graphArgs(repo: Repo, scope: string, pageSize: number): string[] {
  const auto = ['HEAD']
  if (repo.upstream) auto.push(repo.upstream)
  if (repo.defaultBranch) {
    auto.push(repo.branches.local.includes(repo.defaultBranch) ? repo.defaultBranch : `origin/${repo.defaultBranch}`)
  }
  const picked = /^(local|remote):/.test(scope) ? [scope.replace(/^(local|remote):/, '')] : []
  const refs = scope === 'all' ? ['--branches', '--remotes'] : [...new Set([...auto, ...picked])]

  return ['log', '--graph', '--date-order', '--color=never', `--format=${GRAPH_FORMAT}`, '-n', String(pageSize), ...refs, '--']
}

async function readGraphState($: EngineInterface): Promise<GraphState> {
  const saved: Partial<GraphState> = await read($, graphState)

  return { ...GRAPH_START, ...saved }
}

async function setGraph($: EngineInterface, change: Partial<GraphState>) {
  await update($, graphState, graph => ({ ...GRAPH_START, ...graph, ...change }))
}

async function refreshGraph($: EngineInterface) {
  const stored = await read($, repoState)
  const repo = isCurrentRepo(stored) ? stored : await refresh($)
  if (!repo) return

  const graph = await readGraphState($)
  const me = (await git($, ['config', 'user.email'], { cwd: repo.root })).stdout.trim().toLowerCase()
  const log = await git($, graphArgs(repo, graph.scope, graph.pageSize), { cwd: repo.root })
  if (log.exitCode !== 0) throw new Error(failure(log))

  const rows = parseGraph(log.stdout, me)
  const hasMore = rows.filter(row => row.commit).length >= graph.pageSize
  if (JSON.stringify(rows) !== JSON.stringify(graph.rows) || hasMore !== graph.hasMore) {
    await setGraph($, { rows, hasMore })
  }
}

async function openGraph($: EngineInterface) {
  await $.ui.open({ id: GRAPH_PANE, title: GRAPH_TITLE })
  await refreshGraph($)
}

async function runPaneCommand($: EngineInterface) {
  await refresh($).catch(() => null)
  await openPane($)

  return { text: 'Source Control pane opened.' }
}

async function runGraphCommand($: EngineInterface) {
  await refresh($).catch(() => null)
  await openGraph($).catch(() => undefined)

  return { text: 'Commit graph opened.' }
}

// Answers a pane command that threw or ran out of time, so the person sees why instead of a skipped hook.
function commandFailed() {
  return { text: 'Could not open the pane. Run the command again, or press ↻ in the pane if it opened.' }
}

async function isPaneOpen($: EngineInterface, id: string): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === id)
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

async function selectCommit($: EngineInterface, hash: string) {
  const graph = await readGraphState($)
  if (graph.selected === hash) {
    await setGraph($, { selected: null, files: null, naming: null, confirm: null })
    return
  }

  await setGraph($, { selected: hash, files: null, naming: null, confirm: null })
  const commit = graph.rows.find(row => row.commit?.hash === hash)?.commit
  const repo = await requireRepo($)
  if (!commit) return

  const files = await readCommitFiles($, repo, commit)
  if ((await readGraphState($)).selected === hash) await setGraph($, { files })
}

// A commit action changes the branch, so both panes read again after it.
async function afterGraphAction($: EngineInterface, text: string) {
  await setGraph($, { confirm: null, naming: null })
  await setNotice($, 'ok', text)
  await refresh($)
  await refreshGraph($)
}

async function cherryPick($: EngineInterface, commit: GraphCommit) {
  const repo = await requireRepo($)
  const merge = commit.parents.length > 1 ? ['-m', '1'] : []
  const picked = await git($, ['cherry-pick', ...merge, commit.hash], { cwd: repo.root })
  if (picked.exitCode !== 0) {
    await refresh($)
    if (/CONFLICT/.test(picked.stdout + picked.stderr)) {
      throw new Error(`Cherry-picking ${commit.hash} stopped on conflicts: resolve the files marked !, stage them, then commit.`)
    }
    throw new Error(failure(picked))
  }

  await afterGraphAction($, `Cherry-picked ${commit.hash} onto ${repo.branch}.`)
}

async function revertCommit($: EngineInterface, commit: GraphCommit) {
  const repo = await requireRepo($)
  const merge = commit.parents.length > 1 ? ['-m', '1'] : []
  const reverted = await git($, ['revert', '--no-edit', ...merge, commit.hash], { cwd: repo.root })
  if (reverted.exitCode !== 0) {
    await refresh($)
    if (/CONFLICT/.test(reverted.stdout + reverted.stderr)) {
      throw new Error(`Reverting ${commit.hash} stopped on conflicts: resolve the files marked !, stage them, then commit.`)
    }
    throw new Error(failure(reverted))
  }

  await afterGraphAction($, `Reverted ${commit.hash} with a new commit on ${repo.branch}.`)
}

async function checkoutDetached($: EngineInterface, commit: GraphCommit) {
  const repo = await requireRepo($)
  const switched = await git($, ['switch', '--detach', commit.hash], { cwd: repo.root })
  if (switched.exitCode !== 0) throw new Error(failure(switched))

  await afterGraphAction($, `Checked out ${commit.hash} with no branch: create a branch before committing here.`)
}

async function branchAtCommit($: EngineInterface, commit: GraphCommit, name: string) {
  await createBranch($, name, commit.hash)
  await afterGraphAction($, `Created ${name.trim()} at ${commit.hash}, and switched to it.`)
}

function codeColor(code: string): string {
  if (code === 'A' || code === 'U') return 'success'
  if (code === 'D' || code === '!') return 'error'
  if (code === 'R' || code === 'C') return 'suggestion'

  return 'warning'
}

function splitPath(path: string): { name: string; dir: string } {
  const slash = path.lastIndexOf('/')

  return slash < 0 ? { name: path, dir: '' } : { name: path.slice(slash + 1), dir: path.slice(0, slash) }
}

type SyncLine = { text: string; color: string; dot: string }

function syncLine(repo: Repo): SyncLine {
  if (!repo.upstream) return { text: 'Not published yet', color: 'inactive', dot: TONE.muted }
  if (repo.ahead > 0 && repo.behind > 0) return { text: 'Diverged from', color: 'warning', dot: TONE.amber }
  if (repo.ahead > 0) return { text: 'Ahead of', color: 'suggestion', dot: TONE.blue }
  if (repo.behind > 0) return { text: 'Behind', color: 'suggestion', dot: TONE.blue }

  return { text: 'Up to date with', color: 'inactive', dot: TONE.green }
}

type BranchOption = { value: string; label: string }

// Every branch as a picker option: the checked-out one first, then local, then remote, most recent first.
function branchOptions(repo: Repo): BranchOption[] {
  return [
    ...(repo.branch === 'detached HEAD' ? [{ value: 'detached', label: 'detached HEAD' }] : []),
    ...repo.branches.local.map(name => ({ value: `local:${name}`, label: name })),
    ...repo.branches.remote.map(ref => ({ value: `remote:${ref}`, label: `${ref} (remote)` })),
  ]
}

// The main picker: all branches when they fit, else the most recent ones and a way to search the rest.
export function pickerOptions(all: BranchOption[], limit = SELECT_LIMIT): BranchOption[] {
  if (all.length <= limit) return all

  const shown = all.slice(0, limit - 1)

  return [...shown, { value: 'more', label: `More branches… (${all.length - shown.length} more)` }]
}

// The search picker: a prompt row to stay selected (picking it does nothing), then the matches.
export function searchOptions(all: BranchOption[], filter: string): BranchOption[] {
  const needle = filter.trim().toLowerCase()
  const matches = all.filter(option => option.value !== 'detached' && option.label.toLowerCase().includes(needle))
  const shown = matches.slice(0, SELECT_LIMIT - 1)
  const more = matches.length - shown.length
  const prompt = more > 0 ? `${shown.length} of ${matches.length} matches: type more to narrow` : `${plural(matches.length, 'match')}: pick one`

  return matches.length === 0 ? [] : [{ value: 'pick', label: prompt }, ...shown]
}

// A value kept from an earlier version of the pane (state outlives a reload) is read as missing.
function isCurrentRepo(repo: Repo | null): repo is Repo {
  return (
    repo !== null && Array.isArray(repo.incoming) && Array.isArray(repo.branches?.remote) && Array.isArray(repo.stashes)
  )
}

const PROMPT_TITLE: Record<Prompt['kind'], string> = {
  stash: 'Stash',
  create: 'New branch from the current commit',
  createFrom: 'New branch from',
  rename: 'Rename branch',
  delete: 'Delete branch',
  forceDelete: 'Delete branch',
  merge: 'Merge into the current branch',
}

const STASH_LABEL: Record<StashMode, string> = {
  tracked: 'Stash changes',
  untracked: 'Stash changes and new files',
  staged: 'Stash staged changes',
}

function syncHint(repo: Repo): string {
  if (repo.behind > 0 && repo.ahead > 0) return `Sync pulls ${plural(repo.behind, 'commit')}, then pushes your ${repo.ahead}.`
  if (repo.behind > 0) return `Sync pulls ${plural(repo.behind, 'commit')}.`

  return `Sync pushes your ${plural(repo.ahead, 'commit')}.`
}

export const register: Register = (on, options) => {
  const settings: Settings = {
    model: typeof options.model === 'string' && options.model ? options.model : 'haiku',
    includeBody: options.includeBody !== false,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sc-pane',
      description: 'Open the Source Control pane: switch branch, commit, sync and generate a commit message',
    })
    await $.command.register({
      name: 'sc-pane-graph',
      description: 'Open the commit graph: branches, incoming and outgoing commits, and actions on a commit',
    })

    const repo = await refresh($).catch(() => null)
    if (repo) void openPane($)

    // Picks up edits made outside the session (an editor, a terminal) while a pane is open.
    $.clock.every(5_000, () => {
      void (async () => {
        if ((await read($, busyState)) !== null) return
        const panes = await $.ui.panes()
        if (panes.some(pane => pane.id === PANE || pane.id === GRAPH_PANE)) await refresh($)
        if (panes.some(pane => pane.id === GRAPH_PANE)) await refreshGraph($)
      })().catch(() => undefined)
    })

    return next(e)
  })

  on('command.run', { command: 'sc-pane' }, async $ => runPaneCommand($)).catch(commandFailed)
  on('command.run', { command: 'sc-pane-graph' }, async $ => runGraphCommand($)).catch(commandFailed)

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($).catch(() => null)
    if (await isPaneOpen($, GRAPH_PANE).catch(() => false)) await refreshGraph($).catch(() => undefined)

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const Input = 'Input' in elements ? elements.Input : undefined
    const Select = 'Select' in elements ? elements.Select : undefined
    const Svg = 'Svg' in elements ? elements.Svg : undefined
    // Row actions appear on hover where the pointer is reported; the terminal shows them always.
    const revealOnHover = e.surface === 'desktop'

    const stored = await read($, repoState)
    const repo = isCurrentRepo(stored) ? stored : null
    const draft = await read($, draftState)
    const busy = await read($, busyState)
    const notice = await read($, noticeState)
    // A value saved by an earlier version of the pane may lack the newer fields.
    const saved: Partial<PaneUi> = await read($, uiState)
    const ui: PaneUi = {
      collapsed: [],
      menu: null,
      confirm: null,
      branchFilter: null,
      more: null,
      prompt: null,
      ...saved,
    }

    const act = (label: string, action: () => Promise<void>) => () => {
      void run($, label, action)
    }
    const tell = (text: string) => () => {
      void setNotice($, 'error', text)
    }
    const isOpen = (id: string) => !ui.collapsed.includes(id)
    const toggle = (id: string) => () => {
      void setUi($, { collapsed: isOpen(id) ? [...ui.collapsed, id] : ui.collapsed.filter(one => one !== id) })
    }
    const toggleMenu = (menu: 'commit' | 'sync') => () => {
      void setUi($, { menu: ui.menu === menu ? null : menu })
    }
    const ask = (confirm: string) => () => {
      void setUi($, { confirm, menu: null })
    }
    const cancel = () => {
      void setUi($, { confirm: null })
    }
    const openMore = (more: MoreMenu | null) => () => {
      void setUi($, { more, prompt: null, confirm: null, menu: null })
    }
    const openPrompt = (prompt: Prompt) => () => {
      void setUi($, { prompt, confirm: null })
    }
    const closePrompt = () => {
      void setUi($, { prompt: null })
    }
    const editPrompt = (change: Partial<Prompt>) => {
      void update($, uiState, state => (state.prompt ? { ...state, prompt: { ...state.prompt, ...change } } : state))
    }

    const caption = (text: string) => (
      <Text size="caption" weight="semibold" bold dimColor>
        {text.toUpperCase()}
      </Text>
    )

    const header = (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text weight="semibold" bold>
          Source Control
        </Text>
        <Box flexDirection="row" gap="sm" alignItems="center">
          <Button
            key="refresh"
            label="↻"
            plain
            dimColor
            hotkey="r"
            onPress={act('Refreshing…', () => requireRepo($).then(() => undefined))}
          />
          {isCurrentRepo(stored) && (
            <Button key="graph" label="Graph" plain dimColor onPress={act('Reading history…', () => openGraph($))} />
          )}
          {isCurrentRepo(stored) && (
            <Button key="more" label="⋯" plain dimColor hotkey="m" onPress={openMore(ui.more ? null : 'groups')} />
          )}
        </Box>
      </Box>
    )

    const status = busy ? (
      <Text color="suggestion">{busy}</Text>
    ) : notice ? (
      <Text color={notice.kind === 'ok' ? 'success' : 'error'}>{notice.text}</Text>
    ) : null

    if (!repo) {
      return (
        <Box flexDirection="column" gap="md">
          {header}
          {status}
          <Text dimColor>{stored ? 'Reading the repository…' : 'This folder is not a git repository.'}</Text>
        </Box>
      )
    }

    const stagedCount = repo.staged.length
    const hasChanges = stagedCount + repo.unstaged.length > 0
    const isOutOfSync = repo.upstream !== null && (repo.ahead > 0 || repo.behind > 0)
    const line = syncLine(repo)

    // Branch, remote state and the sync actions.
    const isDetached = repo.branch === 'detached HEAD'
    const allBranches = branchOptions(repo)
    const picker = pickerOptions(allBranches)
    const filter = typeof ui.branchFilter === 'string' ? ui.branchFilter : null
    const found = filter === null ? [] : searchOptions(allBranches, filter)
    const switchTo = (value: string) => {
      void (async () => {
        await setUi($, { branchFilter: null })
        await run($, 'Switching branch…', () => switchBranch($, value))
      })()
    }

    const branchSection = (
      <Box flexDirection="column" gap="sm">
        <Box flexDirection="row" gap="sm" alignItems="center">
          {Svg ? (
            <Svg source={svg(ICON.branch, TONE.muted, 16)} alt="Branch" width={16} height={16} />
          ) : (
            <Text dimColor>⎇</Text>
          )}
          {Select && picker.length > 0 ? (
            <Select
              key="branch"
              options={picker}
              value={isDetached ? 'detached' : `local:${repo.branch}`}
              onSelect={value =>
                value === 'more' ? void setUi($, { branchFilter: '', menu: null }) : switchTo(value)
              }
            />
          ) : (
            <Text weight="medium">{repo.branch}</Text>
          )}
        </Box>

        {filter !== null && Input && Select && (
          <Box flexDirection="column" gap="sm">
            <Box flexDirection="row" gap="sm" alignItems="center">
              <Input
                key="branch-filter"
                placeholder="Search all branches"
                value={filter}
                submitLabel="search"
                autoFocus
                onInput={value => void setUi($, { branchFilter: value })}
                onSubmit={value => void setUi($, { branchFilter: value })}
              />
              <Button key="branch-filter-close" label="Cancel" dimColor onPress={() => void setUi($, { branchFilter: null })} />
            </Box>
            {found.length > 0 ? (
              <Select
                key="branch-search"
                options={found}
                value="pick"
                onSelect={value => (value === 'pick' ? undefined : switchTo(value))}
              />
            ) : (
              <Text size="footnote" dimColor>
                No branch matches “{filter}”.
              </Text>
            )}
          </Box>
        )}

        <Box flexDirection="row" gap="sm" alignItems="center">
          {Svg ? <Svg source={dot(line.dot)} alt="" width={8} height={8} /> : <Text color={line.color}>●</Text>}
          <Text size="footnote" color={line.color}>
            {line.text}
          </Text>
          {repo.upstream && (
            <Text mono size="footnote" wrap="truncate-end">
              {repo.upstream}
            </Text>
          )}
        </Box>

        {!repo.upstream ? (
          <Box flexDirection="row" gap="sm" flexWrap="wrap">
            <Button key="publish" variant="primary" hotkey="p" onPress={act('Publishing…', () => push($))}>
              ↑ Publish branch
            </Button>
            <Button key="fetch" hotkey="f" onPress={act('Fetching…', () => fetchAll($))}>
              Fetch
            </Button>
          </Box>
        ) : isOutOfSync ? (
          <Box flexDirection="column" gap="sm">
            <Box flexDirection="row" gap="sm" flexWrap="wrap">
              <Button key="sync" variant="primary" hotkey="s" onPress={act('Syncing…', () => sync($))}>
                ↻ Sync{' '}
                <Text mono>
                  ↓{repo.behind} ↑{repo.ahead}
                </Text>
              </Button>
              <Button key="fetch" hotkey="f" onPress={act('Fetching…', () => fetchAll($))}>
                Fetch
              </Button>
              <Button key="sync-menu" label="⋯" onPress={toggleMenu('sync')} />
            </Box>
            {ui.menu === 'sync' && (
              <Box flexDirection="row" gap="sm" flexWrap="wrap">
                <Button key="pull" hotkey="l" onPress={act('Pulling…', () => pull($))}>
                  ↓ Pull only <Text mono>{repo.behind}</Text>
                </Button>
                <Button key="push" hotkey="p" onPress={act('Pushing…', () => push($))}>
                  ↑ Push only <Text mono>{repo.ahead}</Text>
                </Button>
              </Box>
            )}
            <Text size="footnote" dimColor>
              {syncHint(repo)}
            </Text>
          </Box>
        ) : (
          <Box flexDirection="row" gap="sm" flexWrap="wrap">
            <Button key="fetch" hotkey="f" onPress={act('Fetching…', () => fetchAll($))}>
              Fetch
            </Button>
            <Button key="pull" hotkey="l" onPress={act('Pulling…', () => pull($))}>
              ↓ Pull <Text dimColor>0</Text>
            </Button>
            <Button key="push" hotkey="p" onPress={act('Pushing…', () => push($))}>
              ↑ Push <Text dimColor>0</Text>
            </Button>
          </Box>
        )}
      </Box>
    )

    // The message and the commit actions; dim, and saying why, while there is nothing to commit.
    const commitLabel = stagedCount > 0 ? `Commit ${stagedCount} staged` : 'Commit all'
    const nothingToCommit = tell('Nothing to commit: the working tree is clean.')

    const commitSection = (
      <Box flexDirection="column" gap="sm">
        {caption('Commit message')}
        {Input ? (
          <Input
            key="message"
            placeholder="Describe your changes"
            value={draft.subject}
            submitLabel="save"
            onInput={value => void update($, draftState, d => ({ ...d, subject: value }))}
            onSubmit={value => void update($, draftState, d => ({ ...d, subject: value }))}
          />
        ) : (
          <Text>{draft.subject || 'No message yet.'}</Text>
        )}
        {draft.body && (
          <Text size="footnote" dimColor>
            {draft.body}
          </Text>
        )}
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          {draft.body ? (
            <Button
              key="drop-body"
              label="Remove body"
              plain
              dimColor
              onPress={() => void update($, draftState, d => ({ ...d, body: '' }))}
            />
          ) : (
            <Text> </Text>
          )}
          <Button
            key="generate"
            hotkey="g"
            dimColor={!hasChanges}
            onPress={hasChanges ? act('Writing a message…', () => generate($, settings)) : nothingToCommit}
          >
            ✦ Generate
          </Button>
        </Box>
        <Box flexDirection="row" gap="xs">
          <Button
            key="commit"
            variant={hasChanges ? 'primary' : 'secondary'}
            dimColor={!hasChanges}
            hotkey="c"
            onPress={
              hasChanges
                ? act('Committing…', async () => setNotice($, 'ok', await commit($)))
                : nothingToCommit
            }
          >
            {commitLabel} <Text mono dimColor>C</Text>
          </Button>
          <Button
            key="commit-menu"
            label="▾"
            variant={hasChanges ? 'primary' : 'secondary'}
            dimColor={!hasChanges}
            onPress={hasChanges ? toggleMenu('commit') : nothingToCommit}
          />
        </Box>
        {ui.menu === 'commit' && (
          <Box flexDirection="row" gap="sm">
            <Button key="commit-push" onPress={act('Committing and pushing…', () => commitAndPush($))}>
              {stagedCount > 0 ? 'Commit staged & Push' : 'Commit all & Push'}
            </Button>
          </Box>
        )}
      </Box>
    )

    // Files and commits.
    const sectionHeader = (id: string, title: string, count: number, actions: JSX.Element | null) => (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Button key={`toggle:${id}`} plain dimColor onPress={toggle(id)}>
          {isOpen(id) ? '▾' : '▸'} {title.toUpperCase()} <Text mono>{count}</Text>
        </Button>
        {actions ?? <Text> </Text>}
      </Box>
    )

    const fileRow = (file: FileChange, kind: 'staged' | 'unstaged') => {
      const { name, dir } = splitPath(file.path)
      const isUntracked = file.code === 'U'
      const isConfirming = ui.confirm === `file:${file.path}`

      return (
        <Box key={`${kind}:${file.path}`} flexDirection="column">
          <Box flexDirection="row" gap="sm" alignItems="center" paddingLeft={2}>
            <Text color={codeColor(file.code)} mono>
              {file.code}
            </Text>
            <Text wrap="truncate-end">{name}</Text>
            <Box flexGrow={1} flexShrink={1}>
              <Text size="footnote" dimColor wrap="truncate-start">
                {dir}
              </Text>
            </Box>
            {file.added !== undefined && file.added > 0 && (
              <Text mono size="footnote" color="success">
                +{file.added}
              </Text>
            )}
            {file.removed !== undefined && file.removed > 0 && (
              <Text mono size="footnote" color="error">
                −{file.removed}
              </Text>
            )}
            <Box
              flexDirection="row"
              gap="xs"
              display={revealOnHover ? 'none' : 'flex'}
              hover={revealOnHover ? { display: 'flex' } : undefined}
            >
              {kind === 'staged' ? (
                <Button
                  key={`unstage:${file.path}`}
                  label="−"
                  plain
                  dimColor
                  onPress={act('Unstaging…', () => gitAction($, ['restore', '--staged', '--', file.path]))}
                />
              ) : (
                [
                  <Button
                    key={`discard:${file.path}`}
                    label="↺"
                    plain
                    dimColor
                    onPress={ask(`file:${file.path}`)}
                  />,
                  <Button
                    key={`stage:${file.path}`}
                    label="+"
                    plain
                    dimColor
                    onPress={act('Staging…', () => gitAction($, ['add', '--', file.path]))}
                  />,
                ]
              )}
            </Box>
          </Box>
          {isConfirming && (
            <Box flexDirection="row" gap="sm" alignItems="center" paddingLeft={4} flexWrap="wrap">
              <Text size="footnote" color="warning">
                {isUntracked
                  ? `Delete ${name}? It is not tracked, so this cannot be undone.`
                  : `Discard your changes to ${name}?`}
              </Text>
              <Button
                key={`confirm:${file.path}`}
                label={isUntracked ? 'Delete' : 'Discard'}
                onPress={act('Discarding…', () => discardFile($, file))}
              />
              <Button key={`cancel:${file.path}`} label="Cancel" dimColor onPress={cancel} />
            </Box>
          )}
        </Box>
      )
    }

    const fileList = (id: string, files: FileChange[], kind: 'staged' | 'unstaged') =>
      isOpen(id) && (
        <Box flexDirection="column">
          {files.slice(0, LIST_LIMIT).map(file => fileRow(file, kind))}
          {files.length > LIST_LIMIT && (
            <Text size="footnote" dimColor>
              …and {files.length - LIST_LIMIT} more
            </Text>
          )}
        </Box>
      )

    const stagedSection = stagedCount > 0 && (
      <Box flexDirection="column">
        {sectionHeader(
          'staged',
          'Staged',
          stagedCount,
          <Button
            key="unstage-all"
            label="−"
            plain
            dimColor
            onPress={act('Unstaging…', () => gitAction($, ['reset', '-q']))}
          />,
        )}
        {fileList('staged', repo.staged, 'staged')}
      </Box>
    )

    const untrackedCount = repo.unstaged.filter(file => file.code === 'U').length
    const changesSection = repo.unstaged.length > 0 && (
      <Box flexDirection="column">
        {sectionHeader(
          'changes',
          'Changes',
          repo.unstaged.length,
          <Box flexDirection="row" gap="sm">
            <Button key="discard-all" label="↺" plain dimColor onPress={ask('all')} />
            <Button
              key="stage-all"
              label="+"
              plain
              dimColor
              onPress={act('Staging…', () => gitAction($, ['add', '-A']))}
            />
          </Box>,
        )}
        {ui.confirm === 'all' && (
          <Box flexDirection="row" gap="sm" alignItems="center" paddingLeft={2} flexWrap="wrap">
            <Text size="footnote" color="warning">
              {`Discard all ${plural(repo.unstaged.length, 'change')}?`}
              {untrackedCount > 0 ? ` ${plural(untrackedCount, 'untracked file')} will be deleted.` : ''} This
              cannot be undone.
            </Text>
            <Button key="confirm-all" label="Discard all" onPress={act('Discarding…', () => discardAll($))} />
            <Button key="cancel-all" label="Cancel" dimColor onPress={cancel} />
          </Box>
        )}
        {fileList('changes', repo.unstaged, 'unstaged')}
      </Box>
    )

    const commitList = (id: string, title: string, count: number, commits: Commit[], direction: 'in' | 'out') =>
      count > 0 && (
        <Box flexDirection="column">
          {sectionHeader(id, title, count, null)}
          {isOpen(id) &&
            commits.map(one => (
              <Box key={`${id}:${one.hash}`} flexDirection="row" gap="sm" paddingLeft={2}>
                <Text color={direction === 'in' ? 'suggestion' : 'warning'}>{direction === 'in' ? '↓' : '↑'}</Text>
                <Box flexDirection="column" flexShrink={1}>
                  <Text wrap="truncate-end">{one.subject}</Text>
                  <Text size="footnote" dimColor>
                    <Text mono>{one.hash}</Text> · {one.author} · {one.when}
                  </Text>
                </Box>
              </Box>
            ))}
        </Box>
      )

    const stashSection = repo.stashes.length > 0 && (
      <Box flexDirection="column">
        {sectionHeader('stashes', 'Stashes', repo.stashes.length, null)}
        {isOpen('stashes') &&
          repo.stashes.slice(0, LIST_LIMIT).map(one => (
            <Box key={`stash:${one.index}`} flexDirection="column">
              <Box flexDirection="row" gap="sm" alignItems="center" paddingLeft={2}>
                <Text mono size="footnote" dimColor>
                  {one.ref}
                </Text>
                <Box flexGrow={1} flexShrink={1}>
                  <Text wrap="truncate-end">{one.message}</Text>
                </Box>
                <Text size="footnote" dimColor>
                  {one.branch ? `on ${one.branch} · ` : ''}
                  {one.when}
                </Text>
                <Box
                  flexDirection="row"
                  gap="xs"
                  display={revealOnHover ? 'none' : 'flex'}
                  hover={revealOnHover ? { display: 'flex' } : undefined}
                >
                  <Button
                    key={`stash-apply:${one.index}`}
                    label="Apply"
                    plain
                    dimColor
                    onPress={act('Applying the stash…', () => restoreStash($, one.ref, false))}
                  />
                  <Button
                    key={`stash-pop:${one.index}`}
                    label="Pop"
                    plain
                    dimColor
                    onPress={act('Restoring the stash…', () => restoreStash($, one.ref, true))}
                  />
                  <Button key={`stash-drop:${one.index}`} label="Drop" plain dimColor onPress={ask(`stash:${one.index}`)} />
                </Box>
              </Box>
              {ui.confirm === `stash:${one.index}` && (
                <Box flexDirection="row" gap="sm" alignItems="center" paddingLeft={4} flexWrap="wrap">
                  <Text size="footnote" color="warning">
                    {`Drop ${one.ref} “${one.message}”? This cannot be undone.`}
                  </Text>
                  <Button
                    key={`stash-confirm:${one.index}`}
                    label="Drop"
                    onPress={act('Dropping the stash…', () => dropStash($, one.ref))}
                  />
                  <Button key={`stash-cancel:${one.index}`} label="Cancel" dimColor onPress={cancel} />
                </Box>
              )}
            </Box>
          ))}
      </Box>
    )

    // The ⋯ menu: a row of groups, then one group's commands; forms open under it.
    const latest = repo.stashes[0]?.ref
    const noStash = tell('There are no stashes yet.')
    const last = repo.lastCommit
    const rewriteBlock = !last
      ? 'There is no commit yet.'
      : last.isPushed
        ? `${last.hash} is already pushed: changing it would rewrite shared history.`
        : null
    const otherBranches = allBranches.filter(
      option => option.value !== 'detached' && option.value !== `local:${repo.branch}`,
    )
    const otherLocal = otherBranches.filter(option => option.value.startsWith('local:'))
    const defaultBase =
      repo.defaultBranch && allBranches.some(option => option.value === `local:${repo.defaultBranch}`)
        ? `local:${repo.defaultBranch}`
        : repo.defaultBranch && allBranches.some(option => option.value === `remote:origin/${repo.defaultBranch}`)
          ? `remote:origin/${repo.defaultBranch}`
          : `local:${repo.branch}`
    const menuRow = (children: JSX.Element[]) => (
      <Box flexDirection="row" gap="sm" flexWrap="wrap">
        {children}
      </Box>
    )
    const back = <Button key="more-back" label="‹ Back" dimColor onPress={openMore('groups')} />

    const moreRow =
      ui.more === 'groups'
        ? menuRow([
            <Button key="more-stash" label="Stash" onPress={openMore('stash')} />,
            <Button key="more-branch" label="Branch" onPress={openMore('branch')} />,
            <Button key="more-commit" label="Commit" onPress={openMore('commit')} />,
            <Button key="more-remote" label="Remote" onPress={openMore('remote')} />,
            <Button key="more-close" label="Close" dimColor onPress={openMore(null)} />,
          ])
        : ui.more === 'stash'
          ? menuRow([
              <Button
                key="stash-push"
                label="Stash"
                onPress={openPrompt({ kind: 'stash', text: '', choice: 'tracked' })}
              />,
              <Button
                key="stash-untracked"
                label="Stash incl. untracked"
                onPress={openPrompt({ kind: 'stash', text: '', choice: 'untracked' })}
              />,
              <Button
                key="stash-staged"
                label="Stash staged"
                dimColor={stagedCount === 0}
                onPress={
                  stagedCount > 0 ? openPrompt({ kind: 'stash', text: '', choice: 'staged' }) : tell('Nothing is staged.')
                }
              />,
              <Button
                key="stash-apply-latest"
                label="Apply latest"
                dimColor={!latest}
                onPress={latest ? act('Applying the stash…', () => restoreStash($, latest, false)) : noStash}
              />,
              <Button
                key="stash-pop-latest"
                label="Pop latest"
                dimColor={!latest}
                onPress={latest ? act('Restoring the stash…', () => restoreStash($, latest, true)) : noStash}
              />,
              back,
            ])
          : ui.more === 'branch'
            ? menuRow([
                <Button key="branch-create" label="Create…" onPress={openPrompt({ kind: 'create', text: '', choice: '' })} />,
                <Button
                  key="branch-create-from"
                  label="Create from…"
                  onPress={openPrompt({ kind: 'createFrom', text: '', choice: defaultBase })}
                />,
                <Button
                  key="branch-rename"
                  label="Rename…"
                  dimColor={isDetached}
                  onPress={
                    isDetached
                      ? tell('No branch is checked out to rename.')
                      : openPrompt({ kind: 'rename', text: repo.branch, choice: '' })
                  }
                />,
                <Button
                  key="branch-delete"
                  label="Delete…"
                  dimColor={otherLocal.length === 0}
                  onPress={
                    otherLocal[0]
                      ? openPrompt({ kind: 'delete', text: '', choice: otherLocal[0].value })
                      : tell('There is no other local branch to delete.')
                  }
                />,
                <Button
                  key="branch-merge"
                  label="Merge…"
                  dimColor={isDetached || otherBranches.length === 0}
                  onPress={
                    !isDetached && otherBranches[0]
                      ? openPrompt({
                          kind: 'merge',
                          text: '',
                          choice: defaultBase !== `local:${repo.branch}` ? defaultBase : otherBranches[0].value,
                        })
                      : tell('Check out a branch to merge into first.')
                  }
                />,
                back,
              ])
            : ui.more === 'commit'
              ? menuRow([
                  <Button
                    key="commit-amend"
                    label="Amend last commit"
                    dimColor={rewriteBlock !== null}
                    onPress={rewriteBlock ? tell(rewriteBlock) : act('Amending…', () => amend($))}
                  />,
                  <Button
                    key="commit-undo"
                    label="Undo last commit"
                    dimColor={rewriteBlock !== null}
                    onPress={rewriteBlock ? tell(rewriteBlock) : ask('undo')}
                  />,
                  <Button
                    key="commit-sync"
                    label="Commit & Sync"
                    dimColor={!hasChanges}
                    onPress={
                      hasChanges
                        ? act('Committing and syncing…', () => commitAndSync($))
                        : tell('Nothing to commit: the working tree is clean.')
                    }
                  />,
                  back,
                ])
              : ui.more === 'remote'
                ? menuRow([
                    <Button
                      key="remote-pull-rebase"
                      label="Pull (rebase)"
                      dimColor={!repo.upstream}
                      onPress={
                        repo.upstream
                          ? act('Pulling with rebase…', () => pullRebase($))
                          : tell('This branch has no upstream yet: publish it first.')
                      }
                    />,
                    <Button key="remote-fetch-prune" label="Fetch (prune)" onPress={act('Fetching…', () => fetchPrune($))} />,
                    back,
                  ])
                : null

    const undoConfirm = ui.confirm === 'undo' && last && (
      <Box flexDirection="row" gap="sm" alignItems="center" flexWrap="wrap">
        <Text size="footnote" color="warning">
          {`Undo ${last.hash} “${last.subject}”? Its changes stay staged and its message goes back in the box.`}
        </Text>
        <Button key="undo-confirm" label="Undo" onPress={act('Undoing…', () => undoLastCommit($))} />
        <Button key="undo-cancel" label="Cancel" dimColor onPress={cancel} />
      </Box>
    )

    // Picker values for the forms: at most 64 options, 'more' kept out (it would name no branch).
    const choiceOptions = (options: BranchOption[]) => pickerOptions(options)
    const pickChoice = (value: string) => {
      if (value === 'more') {
        void setNotice($, 'error', 'Only the most recent branches fit here: switch to the one you want first, then use Create….')
        return
      }
      editPrompt({ choice: value })
    }
    const labelOf = (value: string) => allBranches.find(option => option.value === value)?.label ?? value

    const prompt = ui.prompt
    const submitPrompt = (current: Prompt) => {
      if (current.kind === 'stash') {
        void run($, 'Stashing…', () => stash($, current.choice as StashMode, current.text))
      } else if (current.kind === 'create') {
        void run($, 'Creating the branch…', () => createBranch($, current.text))
      } else if (current.kind === 'createFrom') {
        void run($, 'Creating the branch…', () => createBranch($, current.text, current.choice))
      } else if (current.kind === 'rename') {
        void run($, 'Renaming…', () => renameBranch($, current.text))
      } else if (current.kind === 'delete' || current.kind === 'forceDelete') {
        const name = current.choice.replace(/^local:/, '')
        void run($, 'Deleting the branch…', () => deleteBranch($, name, current.kind === 'forceDelete'))
      } else {
        void run($, 'Merging…', () => mergeBranch($, current.choice.replace(/^(local|remote):/, '')))
      }
    }
    const goLabel: Record<Prompt['kind'], string> = {
      stash: 'Stash',
      create: 'Create',
      createFrom: 'Create',
      rename: 'Rename',
      delete: 'Delete',
      forceDelete: 'Delete anyway',
      merge: 'Merge',
    }

    const promptForm = prompt && (
      <Box flexDirection="column" gap="sm">
        {caption(prompt.kind === 'stash' ? STASH_LABEL[prompt.choice as StashMode] ?? 'Stash' : PROMPT_TITLE[prompt.kind])}
        {(prompt.kind === 'createFrom' || prompt.kind === 'delete' || prompt.kind === 'merge') && Select && (
          <Select
            key="prompt-choice"
            options={choiceOptions(prompt.kind === 'delete' ? otherLocal : prompt.kind === 'merge' ? otherBranches : allBranches.filter(option => option.value !== 'detached'))}
            value={prompt.choice}
            onSelect={pickChoice}
          />
        )}
        {prompt.kind === 'merge' && (
          <Text size="footnote" dimColor>
            {`Merges ${labelOf(prompt.choice)} into ${repo.branch}. Conflicts, if any, show in Changes marked !.`}
          </Text>
        )}
        {prompt.kind === 'delete' && (
          <Text size="footnote" dimColor>
            Deletes the local branch only. Its remote branch, if any, stays.
          </Text>
        )}
        {prompt.kind === 'forceDelete' && (
          <Text size="footnote" color="warning">
            {`${prompt.choice.replace(/^local:/, '')} has commits no other branch holds. Deleting it anyway loses them.`}
          </Text>
        )}
        {(prompt.kind === 'stash' || prompt.kind === 'create' || prompt.kind === 'createFrom' || prompt.kind === 'rename') &&
          Input && (
            <Input
              key="prompt-text"
              placeholder={prompt.kind === 'stash' ? 'Message (optional)' : 'Branch name'}
              value={prompt.text}
              submitLabel={goLabel[prompt.kind].toLowerCase()}
              autoFocus
              onInput={value => editPrompt({ text: value })}
              onSubmit={value => submitPrompt({ ...prompt, text: value })}
            />
          )}
        <Box flexDirection="row" gap="sm">
          <Button
            key="prompt-go"
            label={goLabel[prompt.kind]}
            variant="primary"
            onPress={() => submitPrompt(prompt)}
          />
          <Button key="prompt-cancel" label="Cancel" dimColor onPress={closePrompt} />
        </Box>
      </Box>
    )

    const moreSection = (moreRow || promptForm || undoConfirm) && (
      <Box flexDirection="column" gap="sm">
        {moreRow}
        {undoConfirm}
        {promptForm}
      </Box>
    )

    const cleanBadge = Svg ? (
      <Svg source={CLEAN_BADGE} alt="Clean" width={44} height={44} />
    ) : (
      <Text color="success">✓</Text>
    )

    const workSection = hasChanges ? (
      <Box flexDirection="column" gap="sm">
        {stagedSection}
        {changesSection}
      </Box>
    ) : isOutOfSync ? (
      <Box flexDirection="row" gap="sm" alignItems="center" justifyContent="space-between">
        <Box flexDirection="row" gap="sm" alignItems="center">
          {Svg ? (
            <Svg source={svg(ICON.check, TONE.green, 16)} alt="" width={16} height={16} />
          ) : (
            <Text color="success">✓</Text>
          )}
          <Text weight="medium">Working tree clean</Text>
        </Box>
        <Text size="footnote" dimColor>
          0 changes
        </Text>
      </Box>
    ) : (
      <Box flexDirection="column" gap="sm">
        <Box flexDirection="row" gap="sm" alignItems="center">
          {caption('Changes')}
          <Text mono dimColor>
            0
          </Text>
        </Box>
        <Box flexDirection="column" alignItems="center" gap="sm" paddingY={2}>
          {cleanBadge}
          <Text weight="semibold" bold>
            Working tree clean
          </Text>
          <Text size="footnote" dimColor>
            Nothing to commit. Edits you make will show up here.
          </Text>
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column" gap="md">
        {header}
        {status}
        {moreSection}
        {branchSection}
        {commitSection}
        {workSection}
        {stashSection}
        {isOutOfSync && (
          <Box flexDirection="column" gap="sm">
            {commitList('incoming', 'Incoming', repo.behind, repo.incoming, 'in')}
            {commitList('outgoing', 'Outgoing', repo.ahead, repo.outgoing, 'out')}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: GRAPH_PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const Input = 'Input' in elements ? elements.Input : undefined
    const Select = 'Select' in elements ? elements.Select : undefined

    const stored = await read($, repoState)
    const repo = isCurrentRepo(stored) ? stored : null
    const graph = await readGraphState($)
    const busy = await read($, busyState)
    const notice = await read($, noticeState)

    const act = (label: string, action: () => Promise<void>) => () => {
      void run($, label, action)
    }
    const quietly = (action: () => Promise<void>) => () => {
      void action().catch(error => setNotice($, 'error', error instanceof Error ? error.message : String(error)))
    }

    const status = busy ? (
      <Text color="suggestion">{busy}</Text>
    ) : notice ? (
      <Text color={notice.kind === 'ok' ? 'success' : 'error'}>{notice.text}</Text>
    ) : null

    const refreshButton = (
      <Button key="graph-refresh" label="↻" plain dimColor onPress={act('Reading history…', () => refreshGraph($))} />
    )

    if (!repo) {
      return (
        <Box flexDirection="column" gap="md">
          {status}
          <Box flexDirection="row" gap="sm" alignItems="center">
            <Text dimColor>{stored ? 'Reading the repository…' : 'This folder is not a git repository.'}</Text>
            {refreshButton}
          </Box>
        </Box>
      )
    }

    // Two fixed scopes, then branches to add to the automatic set: 64 options at most.
    const scopeOptions = [
      { value: 'auto', label: 'Current, upstream and default branch' },
      { value: 'all', label: 'All branches' },
      ...pickerOptions(
        branchOptions(repo).filter(option => option.value !== 'detached'),
        SELECT_LIMIT - 2,
      ).map(option =>
        option.value === 'more'
          ? { value: 'more', label: 'Older branches are not listed: use All branches' }
          : { value: option.value, label: `+ ${option.label}` },
      ),
    ]
    const scope = scopeOptions.some(option => option.value === graph.scope) ? graph.scope : 'auto'
    const pickScope = (value: string) => {
      if (value === 'more') return
      void (async () => {
        await setGraph($, { scope: value, pageSize: GRAPH_PAGE, selected: null, files: null })
        await refreshGraph($)
      })().catch(error => setNotice($, 'error', error instanceof Error ? error.message : String(error)))
    }

    const incoming = new Set(repo.incoming.map(one => one.hash))
    const outgoing = new Set(repo.outgoing.map(one => one.hash))
    const selected = graph.rows.find(row => row.commit?.hash === graph.selected)?.commit ?? null

    const confirmText: Record<NonNullable<GraphState['confirm']>, (commit: GraphCommit) => string> = {
      'cherry-pick': commit => `Apply ${commit.hash} “${commit.subject}” on top of ${repo.branch}?`,
      revert: commit => `Add a commit to ${repo.branch} that undoes ${commit.hash} “${commit.subject}”?`,
      checkout: commit =>
        `Check out ${commit.hash} with no branch? Commits made there belong to no branch until you create one.`,
    }
    const confirmLabel: Record<NonNullable<GraphState['confirm']>, string> = {
      'cherry-pick': 'Cherry-pick',
      revert: 'Revert',
      checkout: 'Check out',
    }
    const runConfirmed = (commit: GraphCommit, kind: NonNullable<GraphState['confirm']>) =>
      kind === 'cherry-pick'
        ? act('Cherry-picking…', () => cherryPick($, commit))
        : kind === 'revert'
          ? act('Reverting…', () => revertCommit($, commit))
          : act('Checking out…', () => checkoutDetached($, commit))

    const details = (commit: GraphCommit) => (
      <Box flexDirection="column" gap="sm" paddingLeft={4} paddingY={1}>
        <Box flexDirection="row" gap="sm" flexWrap="wrap">
          <Button key="graph-branch" label="Create branch here…" onPress={quietly(() => setGraph($, { naming: '', confirm: null }))} />
          <Button
            key="graph-cherry-pick"
            label="Cherry-pick"
            onPress={quietly(() => setGraph($, { confirm: 'cherry-pick', naming: null }))}
          />
          <Button key="graph-revert" label="Revert" onPress={quietly(() => setGraph($, { confirm: 'revert', naming: null }))} />
          <Button
            key="graph-checkout"
            label="Checkout (detached)"
            onPress={quietly(() => setGraph($, { confirm: 'checkout', naming: null }))}
          />
          <Button
            key="graph-copy"
            label="Copy hash"
            dimColor
            onPress={press =>
              void (async () => {
                const full = (await git($, ['rev-parse', commit.hash], { cwd: repo.root })).stdout.trim() || commit.hash
                const copied = await $.ui.copy({ text: full, surface: press.surface })
                await setNotice($, copied.isCopied ? 'ok' : 'error', copied.isCopied ? `Copied ${full}.` : 'Could not reach the clipboard.')
              })()
            }
          />
        </Box>

        {graph.confirm && (
          <Box flexDirection="row" gap="sm" alignItems="center" flexWrap="wrap">
            <Text size="footnote" color="warning">
              {confirmText[graph.confirm](commit)}
            </Text>
            <Button key="graph-confirm" label={confirmLabel[graph.confirm]} onPress={runConfirmed(commit, graph.confirm)} />
            <Button key="graph-cancel" label="Cancel" dimColor onPress={quietly(() => setGraph($, { confirm: null }))} />
          </Box>
        )}

        {graph.naming !== null && Input && (
          <Box flexDirection="row" gap="sm" alignItems="center" flexWrap="wrap">
            <Input
              key="graph-branch-name"
              placeholder={`New branch at ${commit.hash}`}
              value={graph.naming}
              submitLabel="create"
              autoFocus
              onInput={value => void setGraph($, { naming: value })}
              onSubmit={value => void run($, 'Creating the branch…', () => branchAtCommit($, commit, value))}
            />
            <Button
              key="graph-branch-go"
              label="Create"
              variant="primary"
              onPress={act('Creating the branch…', () => branchAtCommit($, commit, graph.naming ?? ''))}
            />
            <Button key="graph-branch-cancel" label="Cancel" dimColor onPress={quietly(() => setGraph($, { naming: null }))} />
          </Box>
        )}

        {graph.files === null ? (
          <Text size="footnote" dimColor>
            Reading the changed files…
          </Text>
        ) : graph.files.length === 0 ? (
          <Text size="footnote" dimColor>
            No file changes against the first parent.
          </Text>
        ) : (
          <Box flexDirection="column">
            {graph.files.slice(0, LIST_LIMIT).map(file => {
              const { name, dir } = splitPath(file.path)

              return (
                <Box key={`file:${file.path}`} flexDirection="row" gap="sm" alignItems="center">
                  <Text color={codeColor(file.code)} mono>
                    {file.code}
                  </Text>
                  <Text wrap="truncate-end">{name}</Text>
                  <Box flexGrow={1} flexShrink={1}>
                    <Text size="footnote" dimColor wrap="truncate-start">
                      {dir}
                    </Text>
                  </Box>
                  {file.added !== undefined && file.added > 0 && (
                    <Text mono size="footnote" color="success">
                      +{file.added}
                    </Text>
                  )}
                  {file.removed !== undefined && file.removed > 0 && (
                    <Text mono size="footnote" color="error">
                      −{file.removed}
                    </Text>
                  )}
                </Box>
              )
            })}
            {graph.files.length > LIST_LIMIT && (
              <Text size="footnote" dimColor>
                …and {graph.files.length - LIST_LIMIT} more
              </Text>
            )}
          </Box>
        )}
      </Box>
    )

    const pick = (hash: string) => quietly(() => selectCommit($, hash))

    // Lanes are coloured box-drawing characters, two cells per lane, laid out from each commit's parents.
    // Every row's lane block is as wide as the widest and never shrinks, so messages start in one column.
    const commits = graph.rows.flatMap(row => (row.commit ? [row.commit] : []))
    const laid = layoutLanes(commits)
    const widest = Math.min(MAX_LANES, Math.max(1, ...laid.map(row => row.width)))
    // The full subject shows on hover where the pointer is reported; elsewhere the open commit shows it.
    const canHover = e.surface === 'desktop'

    const rows = commits.map((commit, index) => {
      const lane = laid[index]
      const isSelected = selected?.hash === commit.hash
      const shownRefs = commit.refs.slice(0, 2)
      const subject = shortSubject(commit.subject)
      const isCut = subject !== commit.subject

      return (
        <Box key={`graph:${commit.hash}`} flexDirection="row" alignItems="center" gap="sm">
          <Box flexDirection="row" width={widest * 2} flexShrink={0}>
            {lane &&
              laneCells(lane, widest).map(cell => (
                <Box flexDirection="row" width={2} flexShrink={0}>
                  <Text mono bold color={laneTone(cell.glyphLane)}>
                    {cell.glyph}
                  </Text>
                  <Text mono bold color={laneTone(cell.jointLane)}>
                    {cell.joint}
                  </Text>
                </Box>
              ))}
          </Box>
          <Button key={`commit:${commit.hash}`} label={commit.hash} plain dimColor={!isSelected} onPress={pick(commit.hash)} />
          {incoming.has(commit.hash) && <Text color="suggestion">↓</Text>}
          {outgoing.has(commit.hash) && <Text color="warning">↑</Text>}
          {shownRefs.map(ref => (
            <Text size="footnote" weight="semibold" color={ref.startsWith('HEAD') ? 'success' : 'suggestion'} wrap="truncate-middle">
              {ref}
            </Text>
          ))}
          {commit.refs.length > shownRefs.length && (
            <Text size="footnote" dimColor>
              {`+${commit.refs.length - shownRefs.length}`}
            </Text>
          )}
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end" weight={isSelected ? 'semibold' : 'regular'}>
              {subject}
            </Text>
          </Box>
          <Text size="footnote" dimColor wrap="truncate-end">
            {`${commit.author} · ${commit.when}`}
          </Text>
          {isCut && canHover && (
            <Box position="absolute" top={1} left={widest * 2 + 10} display="none" hover={{ display: 'flex' }}>
              <Text inverse wrap="wrap">
                {` ${commit.subject} `}
              </Text>
            </Box>
          )}
        </Box>
      )
    })

    // The open commit sits above the list, so its actions and files never break the drawn lanes.
    const openCommit = selected && (
      <Box flexDirection="column" gap="xs">
        <Box flexDirection="row" gap="sm" alignItems="center">
          <Text mono dimColor>
            {selected.hash}
          </Text>
          <Box flexGrow={1} flexShrink={1}>
            <Text weight="semibold" wrap="truncate-end">
              {selected.subject}
            </Text>
          </Box>
          <Button key="graph-close" label="✕" plain dimColor onPress={pick(selected.hash)} />
        </Box>
        <Text size="footnote" dimColor>
          {`${selected.author} · ${selected.when}${selected.refs.length > 0 ? ` · ${selected.refs.join(', ')}` : ''}`}
        </Text>
        {details(selected)}
      </Box>
    )

    return (
      <Box flexDirection="column" gap="sm">
        <Box flexDirection="row" gap="sm" alignItems="center" justifyContent="space-between">
          {Select ? (
            <Select key="graph-scope" options={scopeOptions} value={scope} onSelect={pickScope} />
          ) : (
            <Text dimColor>{scopeOptions.find(option => option.value === scope)?.label}</Text>
          )}
          {refreshButton}
        </Box>
        {status}
        {openCommit}
        {graph.rows.length === 0 ? (
          <Text dimColor>No commits yet.</Text>
        ) : (
          <Box flexDirection="column">{rows}</Box>
        )}
        {graph.hasMore && (
          <Box>
            <Button
              key="graph-more"
              label="Load more"
              dimColor
              onPress={act('Reading history…', async () => {
                await setGraph($, { pageSize: graph.pageSize + GRAPH_PAGE })
                await refreshGraph($)
              })}
            />
          </Box>
        )}
      </Box>
    )
  })
}
