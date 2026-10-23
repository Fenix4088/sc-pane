import { expect, test } from 'claude-code/testing'
import type { ProcessRunResult } from 'claude-code'

import { laneCells, layoutLanes } from '../hooks/helpers/lanes'
import { parseGraph } from '../hooks/helpers/parse'
import { shortSubject } from '../hooks/helpers/text'

const PANE = {
  plugin: 'sc-pane',
  component: 'Pane',
  requestId: 'sc-pane',
  props: {
    title: 'Source Control',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const SURFACES = ['desktop', 'terminal'] as const

function status(ab: string, entries: string[]): string {
  return [
    '# branch.oid 1111111111111111111111111111111111111111',
    '# branch.head feature/scm',
    '# branch.upstream origin/feature/scm',
    `# branch.ab ${ab}`,
    ...entries,
    '',
  ].join('\0')
}

const CHANGED = [
  '1 M. N... 100644 100644 100644 aaa bbb src/Button.tsx',
  '1 .M N... 100644 100644 100644 aaa bbb README.md',
  '? notes/new file.md',
]

const STATUS = status('+2 -3', CHANGED)

const REFS = [
  'refs/heads/feature/scm',
  'refs/heads/main',
  'refs/remotes/origin/HEAD',
  'refs/remotes/origin/main',
  'refs/remotes/origin/feature/scm',
  'refs/remotes/origin/release/2.3',
  '',
].join('\n')

const LOG_IN = 'aaa1111\x1fUpdate en strings\x1fSam\x1fsam@example.com\x1f2 hours ago\x1e'
const LOG_OUT =
  'bbb2222\x1fWire ga locale\x1fMe\x1fme@example.com\x1f12 minutes ago\x1e' +
  'ccc3333\x1fAdd ga strings\x1fMe\x1fme@example.com\x1f40 minutes ago\x1e'

function ok(stdout = ''): { value: ProcessRunResult } {
  return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
}

function fail(stderr: string): { value: ProcessRunResult } {
  return { value: { exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } }
}

type Call = { argv: readonly string[]; stdin?: string }

type Fake = { stashes?: string; isPushed?: boolean }

// A fake git: answers what the pane reads, and records every call.
function fakeGit(calls: Call[], statusText: () => string, fake: Fake = {}) {
  return async (_$: unknown, e: { argv: readonly string[]; init?: { stdin?: string } }) => {
    calls.push({ argv: e.argv, stdin: e.init?.stdin })
    const [, command, ...rest] = e.argv
    if (command === 'stash' && rest[0] === 'list') return ok(fake.stashes ?? '')
    if (command === 'symbolic-ref') return ok('origin/main\n')
    if (command === 'branch' && rest[0] === '-r') return ok(fake.isPushed ? '  origin/feature/scm\n' : '')
    if (command === 'check-ref-format') return /\s|\.\./.test(rest[1] ?? '') ? fail('fatal: not a valid branch name') : ok(rest[1])
    if (command === 'log' && rest.includes('-1')) return ok('abc1234\x1fAdd ga strings\n')
    if (command === 'rev-parse' && rest[0] === '--show-toplevel') return ok('C:/repo\n')
    if (command === 'rev-parse') return ok('abc1234\n')
    if (command === 'status') return ok(statusText())
    if (command === 'for-each-ref') return ok(REFS)
    if (command === 'config') return ok('me@example.com\n')
    if (command === 'diff' && rest.includes('--numstat')) {
      return ok(rest.includes('--cached') ? '3\t1\tsrc/Button.tsx\0' : '12\t4\tREADME.md\0')
    }
    if (command === 'diff' && rest.includes('--stat')) return ok(' src/Button.tsx | 4 ++--\n')
    if (command === 'diff') return ok('diff --git a/src/Button.tsx b/src/Button.tsx\n-old\n+new\n')
    if (command === 'log' && rest.includes('HEAD..@{u}')) return ok(LOG_IN)
    if (command === 'log' && rest.includes('@{u}..HEAD')) return ok(LOG_OUT)
    if (command === 'log') return ok('feat(i18n): add Irish\nfix(ci): untrack file\n')

    return ok()
  }
}

// What the pane asked git to do, leaving out the reads it makes on every refresh.
const READS = new Set(['list', '-r'])

function ran(calls: Call[], command: string) {
  return calls
    .filter(call => call.argv[1] === command && !READS.has(call.argv[2] ?? ''))
    .map(call => call.argv.slice(2))
}

async function openGroup(ui: { press: (target: { key: string }) => Promise<unknown> }, group: string) {
  await ui.press({ key: 'more' })
  await ui.press({ key: `more-${group}` })
}

const STASHES = 'stash@{0}\x1fOn feature/scm: wip login\x1f2 hours ago\x1e'

// What `git log --graph --format=GRAPH_FORMAT` prints for a merge of one side branch.
const GRAPH = [
  '* \x1faaa1111\x1fbbb2222\x1fHEAD -> feature/scm, origin/feature/scm\x1fAdd pane\x1fMe\x1fme@example.com\x1f1 hour ago',
  '*   \x1fbbb2222\x1fccc3333 ddd4444\x1forigin/main, main, origin/HEAD\x1fMerge pull request #2 from acme/feature/a-very-long-branch-name-that-keeps-going\x1fSam\x1fsam@example.com\x1f2 days ago',
  '|\\  ',
  '| * \x1fddd4444\x1fccc3333\x1f\x1fFix button\x1fSam\x1fsam@example.com\x1f3 days ago',
  '|/  ',
  '* \x1fccc3333\x1f\x1ftag: v1.0\x1fFirst commit\x1fMe\x1fme@example.com\x1f4 days ago',
  '',
].join('\n')

const GRAPH_PANE = { ...PANE, requestId: 'sc-pane-graph', props: { ...PANE.props, title: 'Graph' } } as const

test('parseGraph keeps git lanes and reads each commit record', () => {
  const rows = parseGraph(GRAPH, 'me@example.com')

  expect(rows.map(row => row.prefix)).toEqual(['*', '*', '|\\', '| *', '|/', '*'])
  expect(rows.filter(row => row.commit).map(row => row.commit?.hash)).toEqual(['aaa1111', 'bbb2222', 'ddd4444', 'ccc3333'])
  expect(rows[0]?.commit).toEqual({
    hash: 'aaa1111',
    parents: ['bbb2222'],
    refs: ['HEAD → feature/scm', 'origin/feature/scm'],
    subject: 'Add pane',
    author: 'you',
    when: '1 hour ago',
  })
  expect(rows[1]?.commit?.parents).toEqual(['ccc3333', 'ddd4444'])
  expect(rows[1]?.commit?.refs).toEqual(['origin/main', 'main'])
  expect(rows[5]?.commit?.parents).toEqual([])

  // A control character in a subject would get the whole pane refused.
  const [tabbed] = parseGraph('* \x1feee5555\x1f\x1f\x1fFix\tthe\u0085thing\x1fSam\x1fs@x\x1fnow', '')
  expect(tabbed?.commit?.subject).toBe('Fix the thing')
})

test('layoutLanes gives a side branch its own lane and joins it back at the merge', () => {
  const commits = parseGraph(GRAPH, '').flatMap(row => (row.commit ? [row.commit] : []))
  const rows = layoutLanes(commits)

  expect(rows.map(row => [row.hash, row.col])).toEqual([
    ['aaa1111', 0],
    ['bbb2222', 0],
    ['ddd4444', 1],
    ['ccc3333', 0],
  ])
  // The merge opens lane 1 for its second parent.
  expect(rows[1]?.isMerge).toBe(true)
  expect(rows[1]?.segments).toContainEqual({ from: 0, to: 1, half: 'bottom', lane: 1 })
  // Lane 0 runs straight past the side commit.
  expect(rows[2]?.segments).toContainEqual({ from: 0, to: 0, half: 'full', lane: 0 })
  // Both lanes end in the shared parent.
  expect(rows[3]?.segments).toContainEqual({ from: 1, to: 0, half: 'top', lane: 1 })
  expect(rows[3]?.segments).toContainEqual({ from: 0, to: 0, half: 'top', lane: 0 })
  expect(rows[3]?.segments.some(segment => segment.half === 'bottom')).toBe(false)

  // Drawn as text: the side branch leaves the merge to the right and comes back into the shared parent.
  const text = rows.map(row => laneCells(row, 2).map(cell => cell.glyph + cell.joint).join(''))
  expect(text).toEqual(['●   ', '○─╮ ', '│ ● ', '●─╯ '])

  expect(shortSubject('short')).toBe('short')
  const long = shortSubject('x'.repeat(80))
  expect(long).toHaveLength(60)
  expect(long.endsWith('…')).toBe(true)
})

test('the graph pane walks the chosen refs and acts on a selected commit after asking', async ($, on) => {
  const calls: Call[] = []
  const copied: string[] = []
  on('process.run', async (_$, e) => {
    const [, command, ...rest] = e.argv
    if (command === 'log' && rest.includes('--graph')) {
      calls.push({ argv: e.argv })
      return ok(GRAPH)
    }
    if (command === 'diff' && rest.includes('--name-status')) {
      calls.push({ argv: e.argv })
      return ok('M\0src/a.ts\0A\0src/b.ts\0')
    }
    if (command === 'diff' && rest.includes('ddd4444')) return ok('5\t2\tsrc/a.ts\0')

    return fakeGit(calls, () => STATUS)(_$, e)
  })
  on('ui.copy', async (_$, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })

  // The refs after `-n <count>`.
  const graphLogs = () =>
    calls.filter(call => call.argv.includes('--graph')).map(call => call.argv.slice(call.argv.indexOf('-n') + 2))

  for (const surface of SURFACES) {
    calls.length = 0
    copied.length = 0
    const ui = await $.ui.mount({ ...GRAPH_PANE, surface })
    await ui.press({ key: 'graph-refresh' })

    expect(graphLogs().at(-1)).toEqual(['HEAD', 'origin/feature/scm', 'main', '--'])
    expect(await ui.find({ key: 'commit:aaa1111' })).toBeDefined()
    expect(await ui.find({ text: /Add pane/ })).toBeDefined()
    expect(await ui.find({ text: /origin\/main/ })).toBeDefined()
    // Lanes are text on every surface: the merge dot and the side branch's curve are drawn.
    expect(await ui.find({ text: '○' })).toBeDefined()
    expect(await ui.find({ text: '╮' })).toBeDefined()
    // A long subject is cut; on desktop the whole of it waits in a hover card.
    expect(await ui.find({ text: /^Merge pull request #2 from acme\/feature\/a-very-long-bra.*…$/ })).toBeDefined()
    expect(Boolean(await ui.find({ text: / Merge pull request #2 from acme\/feature\/a-very-long-branch-name-that-keeps-going $/ }))).toBe(
      surface === 'desktop',
    )

    await ui.press({ key: 'commit:ddd4444' })
    expect(ran(calls, 'diff').at(-1)).toEqual(['--name-status', '-z', 'ccc3333', 'ddd4444'])
    expect((await ui.find({ key: 'file:src/a.ts' }))?.text).toContain('+5')
    expect(await ui.find({ key: 'file:src/b.ts' })).toBeDefined()

    await ui.press({ key: 'graph-cherry-pick' })
    expect(ran(calls, 'cherry-pick')).toEqual([])
    expect(await ui.find({ text: 'Apply ddd4444 “Fix button” on top of feature/scm?' })).toBeDefined()
    await ui.press({ key: 'graph-confirm' })
    expect(ran(calls, 'cherry-pick')).toEqual([['ddd4444']])

    await ui.press({ key: 'graph-branch' })
    await ui.input({ key: 'graph-branch-name', text: 'hotfix/button', kind: 'submit' })
    expect(ran(calls, 'switch')).toEqual([['-c', 'hotfix/button', 'ddd4444']])

    await ui.press({ key: 'graph-copy' })
    expect(copied).toEqual(['abc1234'])

    // A merge is reverted against its first parent.
    await ui.press({ key: 'commit:bbb2222' })
    await ui.press({ key: 'graph-revert' })
    await ui.press({ key: 'graph-confirm' })
    expect(ran(calls, 'revert')).toEqual([['--no-edit', '-m', '1', 'bbb2222']])

    await ui.select({ key: 'graph-scope', value: 'all' })
    expect(graphLogs().at(-1)).toEqual(['--branches', '--remotes', '--'])
    await ui.select({ key: 'graph-scope', value: 'remote:origin/release/2.3' })
    expect(graphLogs().at(-1)).toEqual(['HEAD', 'origin/feature/scm', 'main', 'origin/release/2.3', '--'])

    // The scope is session state and outlives this drawing: put it back for the next surface.
    await ui.select({ key: 'graph-scope', value: 'auto' })
    await ui.unmount()
  }
})

test('the ⋯ menu stashes, with or without new files, and a message', async ($, on) => {
  const calls: Call[] = []
  on('process.run', fakeGit(calls, () => STATUS))

  for (const surface of SURFACES) {
    calls.length = 0
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'refresh' })

    await ui.press({ key: 'more' })
    expect(await ui.find({ key: 'more-stash' })).toBeDefined()
    await ui.press({ key: 'more-stash' })
    await ui.press({ key: 'stash-push' })
    await ui.input({ key: 'prompt-text', text: 'wip login', kind: 'change' })
    await ui.press({ key: 'prompt-go' })
    expect(ran(calls, 'stash')).toEqual([['push', '-m', 'wip login']])
    expect(await ui.find({ key: 'prompt-text' })).toBeUndefined()

    await openGroup(ui, 'stash')
    await ui.press({ key: 'stash-untracked' })
    await ui.press({ key: 'prompt-go' })
    expect(ran(calls, 'stash').at(-1)).toEqual(['push', '--include-untracked'])

    await ui.unmount()
  }
})

test('the Stashes section applies, pops, and drops only after confirming', async ($, on) => {
  const calls: Call[] = []
  on('process.run', fakeGit(calls, () => STATUS, { stashes: STASHES }))

  for (const surface of SURFACES) {
    calls.length = 0
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'refresh' })

    expect(await ui.find({ text: 'wip login' })).toBeDefined()
    expect(await ui.find({ text: /on feature\/scm · 2 hours ago/ })).toBeDefined()

    await ui.press({ key: 'stash-apply:0' })
    await ui.press({ key: 'stash-pop:0' })
    expect(ran(calls, 'stash')).toEqual([
      ['apply', 'stash@{0}'],
      ['pop', 'stash@{0}'],
    ])

    await ui.press({ key: 'stash-drop:0' })
    expect(await ui.find({ text: 'Drop stash@{0} “wip login”? This cannot be undone.' })).toBeDefined()
    await ui.press({ key: 'stash-cancel:0' })
    expect(ran(calls, 'stash').some(args => args[0] === 'drop')).toBe(false)

    await ui.press({ key: 'stash-drop:0' })
    await ui.press({ key: 'stash-confirm:0' })
    expect(ran(calls, 'stash').at(-1)).toEqual(['drop', 'stash@{0}'])

    await ui.unmount()
  }
})

test('branch commands: create from a base, rename, merge, and delete with a second ask when unmerged', async ($, on) => {
  const calls: Call[] = []
  let isMerged = true
  on('process.run', async (_$, e) => {
    if (e.argv[1] === 'branch' && e.argv[2] === '-d' && !isMerged) {
      calls.push({ argv: e.argv })
      return fail("error: the branch 'main' is not fully merged.")
    }

    return fakeGit(calls, () => STATUS)(_$, e)
  })

  for (const surface of SURFACES) {
    calls.length = 0
    isMerged = true
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'refresh' })

    await openGroup(ui, 'branch')
    await ui.press({ key: 'branch-create-from' })
    // The default branch (origin/HEAD → main) is the starting base.
    expect((await ui.find({ key: 'prompt-choice' }))?.props.value).toBe('local:main')
    await ui.select({ key: 'prompt-choice', value: 'remote:origin/release/2.3' })
    await ui.input({ key: 'prompt-text', text: 'bad name', kind: 'change' })
    await ui.press({ key: 'prompt-go' })
    expect(await ui.find({ text: '“bad name” is not a valid branch name.' })).toBeDefined()
    expect(ran(calls, 'switch')).toEqual([])

    await openGroup(ui, 'branch')
    await ui.press({ key: 'branch-create-from' })
    await ui.select({ key: 'prompt-choice', value: 'remote:origin/release/2.3' })
    await ui.input({ key: 'prompt-text', text: 'feature/x', kind: 'submit' })
    expect(ran(calls, 'switch')).toEqual([['-c', 'feature/x', 'origin/release/2.3']])

    await openGroup(ui, 'branch')
    await ui.press({ key: 'branch-rename' })
    expect((await ui.find({ key: 'prompt-text' }))?.props.value).toBe('feature/scm')
    await ui.input({ key: 'prompt-text', text: 'feature/scm-v2', kind: 'submit' })
    expect(ran(calls, 'branch')).toEqual([['-m', 'feature/scm-v2']])

    await openGroup(ui, 'branch')
    await ui.press({ key: 'branch-merge' })
    await ui.press({ key: 'prompt-go' })
    expect(ran(calls, 'merge')).toEqual([['--no-edit', 'main']])

    await openGroup(ui, 'branch')
    await ui.press({ key: 'branch-delete' })
    const choices = (await ui.find({ key: 'prompt-choice' }))?.props.options as { value: string }[]
    expect(choices.map(option => option.value)).toEqual(['local:main'])
    isMerged = false
    await ui.press({ key: 'prompt-go' })
    expect(await ui.find({ text: /has commits no other branch holds/ })).toBeDefined()
    expect((await ui.find({ key: 'prompt-go' }))?.text).toBe('Delete anyway')
    await ui.press({ key: 'prompt-go' })
    expect(ran(calls, 'branch').slice(-2)).toEqual([
      ['-d', 'main'],
      ['-D', 'main'],
    ])

    await ui.unmount()
  }
})

test('amend and undo refuse a pushed commit and work on an unpushed one', async ($, on) => {
  const calls: Call[] = []
  let isPushed = true
  on('fs.exists', async () => ({ value: false }))
  on('process.run', async (_$, e) => fakeGit(calls, () => STATUS, { isPushed })(_$, e))

  for (const surface of SURFACES) {
    calls.length = 0
    isPushed = true
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'refresh' })

    await openGroup(ui, 'commit')
    await ui.press({ key: 'commit-amend' })
    expect(await ui.find({ text: /abc1234 is already pushed/ })).toBeDefined()
    expect(ran(calls, 'commit')).toEqual([])

    isPushed = false
    await ui.press({ key: 'refresh' })
    await ui.input({ key: 'message', text: 'fix(button): better focus', kind: 'change' })
    await openGroup(ui, 'commit')
    await ui.press({ key: 'commit-amend' })
    const amended = calls.find(call => call.argv[1] === 'commit')
    expect(amended?.argv).toEqual(['git', 'commit', '--amend', '-F', '-'])
    expect(amended?.stdin).toBe('fix(button): better focus\n')

    await openGroup(ui, 'commit')
    await ui.press({ key: 'commit-undo' })
    expect(ran(calls, 'reset')).toEqual([])
    await ui.press({ key: 'undo-confirm' })
    expect(ran(calls, 'reset')).toEqual([['--soft', 'HEAD~1']])
    expect((await ui.find({ key: 'message' }))?.props.value).toBe('Add ga strings')

    await ui.unmount()
  }
})

test('shows changes with line counts and commits a generated message', async ($, on) => {
  const calls: Call[] = []
  on('process.run', fakeGit(calls, () => STATUS))
  on('fs.exists', async () => ({ value: false }))
  on('model.complete', async (_$, e) => {
    expect(e.prompt).toContain('Changes to describe (staged)')
    expect(e.prompt).toContain('feat(i18n): add Irish')

    return {
      value: {
        isAnswered: true as const,
        text: '```\nfix(button): keep focus ring on press\n\n- restore outline\n```',
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }
  })

  for (const surface of SURFACES) {
    calls.length = 0
    const ui = await $.ui.mount({ ...PANE, surface })

    await ui.press({ key: 'refresh' })
    const sync = (await ui.find({ key: 'sync' }))?.text
    expect(sync).toContain('↓3')
    expect(sync).toContain('↑2')
    expect(await ui.find({ text: 'Diverged from' })).toBeDefined()
    expect(await ui.find({ text: 'Sync pulls 3 commits, then pushes your 2.' })).toBeDefined()
    expect((await ui.find({ key: 'commit' }))?.text).toContain('Commit 1 staged')
    expect(await ui.find({ text: '+3' })).toBeDefined()
    expect(await ui.find({ text: '−4' })).toBeDefined()
    expect(await ui.find({ key: 'unstage:src/Button.tsx' })).toBeDefined()
    expect(await ui.find({ key: 'stage:notes/new file.md' })).toBeDefined()
    expect(await ui.find({ text: 'Update en strings' })).toBeDefined()
    expect(await ui.find({ text: /you/ })).toBeDefined()

    await ui.press({ key: 'generate' })
    expect((await ui.find({ key: 'message' }))?.props.value).toBe('fix(button): keep focus ring on press')
    expect(await ui.find({ text: '- restore outline' })).toBeDefined()

    await ui.press({ key: 'commit' })
    const commit = calls.find(call => call.argv[1] === 'commit')
    expect(commit?.argv).toEqual(['git', 'commit', '-F', '-'])
    expect(commit?.stdin).toBe('fix(button): keep focus ring on press\n\n- restore outline\n')
    // Something was staged, so the pane must not stage the rest.
    expect(ran(calls, 'add')).toEqual([])
    expect(await ui.find({ text: /Committed abc1234/ })).toBeDefined()
    expect((await ui.find({ key: 'message' }))?.props.value).toBe('')

    await ui.unmount()
  }
})

test('/sc-pane opens the pane and /sc-pane-graph the graph', async ($, on) => {
  const calls: Call[] = []
  const opened: string[] = []
  on('process.run', fakeGit(calls, () => STATUS))
  on('ui.open', async (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })

  for (const [command, pane] of [
    ['sc-pane', 'sc-pane'],
    ['sc-pane-graph', 'sc-pane-graph'],
  ] as const) {
    opened.length = 0
    await $.command.run({
      command,
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })
    expect(opened).toEqual([pane])
  }
})

test('refuses to commit without a message', async ($, on) => {
  const calls: Call[] = []
  on('process.run', fakeGit(calls, () => STATUS))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'commit' })

  expect(await ui.find({ text: /Write a message/ })).toBeDefined()
  expect(ran(calls, 'commit')).toEqual([])
  await ui.unmount()
})

test('discards only after the row is confirmed', async ($, on) => {
  const calls: Call[] = []
  on('process.run', fakeGit(calls, () => STATUS))

  for (const surface of SURFACES) {
    calls.length = 0
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'refresh' })

    await ui.press({ key: 'discard:README.md' })
    expect(ran(calls, 'restore')).toEqual([])
    expect(await ui.find({ text: 'Discard your changes to README.md?' })).toBeDefined()
    await ui.press({ key: 'cancel:README.md' })
    expect(await ui.find({ key: 'confirm:README.md' })).toBeUndefined()

    await ui.press({ key: 'discard:README.md' })
    await ui.press({ key: 'confirm:README.md' })
    expect(ran(calls, 'restore')).toEqual([['--worktree', '--', 'README.md']])

    await ui.press({ key: 'discard:notes/new file.md' })
    expect((await ui.find({ key: 'confirm:notes/new file.md' }))?.text).toBe('Delete')
    await ui.press({ key: 'confirm:notes/new file.md' })
    expect(ran(calls, 'clean')).toEqual([['-f', '--', 'notes/new file.md']])

    await ui.press({ key: 'discard-all' })
    expect(await ui.find({ text: /1 untracked file will be deleted/ })).toBeDefined()
    await ui.press({ key: 'confirm-all' })
    expect(ran(calls, 'restore').at(-1)).toEqual(['--worktree', '--', '.'])
    expect(ran(calls, 'clean').at(-1)).toEqual(['-fd'])

    await ui.unmount()
  }
})

test('sync pulls first, then pushes what is still ahead', async ($, on) => {
  const calls: Call[] = []
  let pulled = false
  on('process.run', async (_$, e) => {
    if (e.argv[1] === 'pull') pulled = true

    return fakeGit(calls, () => status(pulled ? '+2 -0' : '+2 -3', []))(_$, e)
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ text: 'Working tree clean' })).toBeDefined()
  expect(await ui.find({ text: '0 changes' })).toBeDefined()

  await ui.press({ key: 'sync' })
  const network = calls.map(call => call.argv[1]).filter(command => command === 'pull' || command === 'push')
  expect(network).toEqual(['pull', 'push'])
  expect(await ui.find({ text: 'Synced: pulled 3 commits, then pushed 2.' })).toBeDefined()

  await ui.press({ key: 'sync-menu' })
  expect(await ui.find({ key: 'pull' })).toBeDefined()
  expect(await ui.find({ key: 'push' })).toBeDefined()
  await ui.unmount()
})

test('a clean, synced tree shows the empty state and dims commit', async ($, on) => {
  const calls: Call[] = []
  on('process.run', fakeGit(calls, () => status('+0 -0', [])))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })

  expect(await ui.find({ text: 'Up to date with' })).toBeDefined()
  expect(await ui.find({ text: 'Nothing to commit. Edits you make will show up here.' })).toBeDefined()
  expect((await ui.find({ key: 'commit' }))?.props.dimColor).toBe(true)
  expect(await ui.find({ key: 'sync' })).toBeUndefined()

  await ui.press({ key: 'commit' })
  expect(await ui.find({ text: /Nothing to commit: the working tree is clean/ })).toBeDefined()
  expect(ran(calls, 'commit')).toEqual([])
  await ui.unmount()
})

test('with more branches than a picker holds, lists the recent ones and searches the rest', async ($, on) => {
  const calls: Call[] = []
  const many = Array.from({ length: 90 }, (_, i) => `refs/remotes/origin/bugfix/TICKET-${100 + i}`)
  on('process.run', async (_$, e) => {
    if (e.argv[1] === 'for-each-ref') {
      calls.push({ argv: e.argv })
      return ok(['refs/heads/feature/scm', ...many, ''].join('\n'))
    }

    return fakeGit(calls, () => STATUS)(_$, e)
  })

  for (const surface of SURFACES) {
    calls.length = 0
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'refresh' })

    const options = (await ui.find({ key: 'branch' }))?.props.options as { value: string; label: string }[]
    expect(options).toHaveLength(64)
    expect(options[0]).toEqual({ value: 'local:feature/scm', label: 'feature/scm' })
    expect(options[63]).toEqual({ value: 'more', label: 'More branches… (28 more)' })

    await ui.select({ key: 'branch', value: 'more' })
    expect(ran(calls, 'switch')).toEqual([])
    await ui.input({ key: 'branch-filter', text: 'TICKET-18', kind: 'change' })
    const found = (await ui.find({ key: 'branch-search' }))?.props.options as { value: string }[]
    expect(found.map(option => option.value)).toEqual([
      'pick',
      ...Array.from({ length: 10 }, (_, i) => `remote:origin/bugfix/TICKET-${180 + i}`),
    ])

    await ui.select({ key: 'branch-search', value: 'remote:origin/bugfix/TICKET-185' })
    expect(ran(calls, 'switch')).toEqual([['--track', 'origin/bugfix/TICKET-185']])
    expect(await ui.find({ key: 'branch-filter' })).toBeUndefined()

    await ui.unmount()
  }
})

test('lists local and remote branches and switches between them', async ($, on) => {
  const calls: Call[] = []
  on('process.run', fakeGit(calls, () => STATUS))

  for (const surface of SURFACES) {
    calls.length = 0
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'refresh' })

    const picker = await ui.find({ key: 'branch' })
    expect(picker?.props.value).toBe('local:feature/scm')
    // origin/main and origin/feature/scm have local branches, so only origin/release/2.3 is listed as remote.
    expect(picker?.props.options).toEqual([
      { value: 'local:feature/scm', label: 'feature/scm' },
      { value: 'local:main', label: 'main' },
      { value: 'remote:origin/release/2.3', label: 'origin/release/2.3 (remote)' },
    ])

    await ui.select({ key: 'branch', value: 'local:feature/scm' })
    expect(ran(calls, 'switch')).toEqual([])

    await ui.select({ key: 'branch', value: 'local:main' })
    await ui.select({ key: 'branch', value: 'remote:origin/release/2.3' })
    expect(ran(calls, 'switch')).toEqual([['main'], ['--track', 'origin/release/2.3']])
    expect(await ui.find({ text: /Created release\/2\.3 tracking origin\/release\/2\.3/ })).toBeDefined()

    await ui.unmount()
  }
})
