import { expect, test } from 'claude-code/testing'
import type { ProcessRunResult } from 'claude-code'

import { refPills } from '../hooks/helpers/branches'
import { continuingCells, laneCells, lanesBelow, layoutLanes } from '../hooks/helpers/lanes'
import { parseGraph } from '../hooks/helpers/parse'
import { draftOf, messageText, middleCut, shortAge, shortDir, shortSubject, wrapText } from '../hooks/helpers/text'
import { fileTree } from '../hooks/helpers/tree'

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

type Presser = { press: (target: { key: string }) => Promise<unknown> }

async function openBranchCommands(ui: Presser) {
  await ui.press({ key: 'more' })
  await ui.press({ key: 'more-branch' })
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

test('FR-GR-2 NFR-2 parseGraph keeps git lanes and reads each commit record', () => {
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

test('FR-GR-3 layoutLanes gives a side branch its own lane and joins it back at the merge', () => {
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

  // Drawn as text: the checked-out commit is hollow, the side branch leaves the merge to the right and comes back
  // into the shared parent.
  const text = rows.map(row => laneCells(row, 2).map(cell => cell.glyph + cell.joint).join(''))
  expect(text).toEqual(['○   ', '●─╮ ', '│ ● ', '●─╯ '])

  // An open commit's panel carries on the lanes that leave its row downwards.
  expect(rows.map(lanesBelow)).toEqual([[0], [0, 1], [0, 1], []])
  expect(continuingCells(rows[2]!, 2).map(cell => cell.glyph).join('')).toBe('││')

  expect(shortSubject('short')).toBe('short')
  const long = shortSubject('x'.repeat(80))
  expect(long).toHaveLength(60)
  expect(long.endsWith('…')).toBe(true)
  expect(shortSubject('x'.repeat(80), 20)).toHaveLength(20)
})

test('FR-GR-5 graph rows label refs and ages the way the design reads them', () => {
  expect(refPills(['HEAD → feature/scm', 'origin/feature/scm'], ['origin'])).toEqual([
    { text: 'feature/scm ⇄ origin', isHead: true },
  ])
  expect(refPills(['origin/main', 'main', 'origin/release/2.3', 'tag: v1.0'], ['origin'])).toEqual([
    { text: 'main ⇄ origin', isHead: false },
    { text: 'origin/release/2.3', isHead: false },
    { text: 'tag: v1.0', isHead: false },
  ])
  expect(refPills(['HEAD'], ['origin'])).toEqual([{ text: 'HEAD', isHead: true }])

  expect(['12 minutes ago', '3 hours ago', '2 days ago', '5 weeks ago', '4 months ago', '1 year, 2 months ago'].map(shortAge)).toEqual([
    '12m',
    '3h',
    '2d',
    '5w',
    '4mo',
    '1y',
  ])
  expect(wrapText('Merge pull request #2 from acme/feature', 20)).toEqual(['Merge pull request', '#2 from acme/feature'])
  expect(middleCut('feature/a-very-long-name', 12)).toBe('featur…-name')
})

test('FR-MSG-1 the message box reads back exactly what was typed', () => {
  for (const typed of ['fix: a', 'fix: a\n', 'fix: a\n\n- one\n- two', '']) {
    expect(messageText(draftOf(typed))).toBe(typed)
  }
  // A generated message, or one saved by an earlier version, keeps its body under a blank line.
  expect(messageText({ subject: 'fix: a', body: '- one' })).toBe('fix: a\n\n- one')
})

test('FR-CHG-7 the tree view nests folders that hold changes and lists root files last', () => {
  const files = [
    { path: 'README.md', code: 'M' },
    { path: 'skills/react/SKILL.md', code: 'U' },
    { path: 'skills/react/rules/a.md', code: 'U' },
    { path: 'src/ui/Button.tsx', code: 'M' },
  ]
  const rows = fileTree(files, dir => dir !== 'src/ui')

  expect(rows.map(row => (row.kind === 'folder' ? `${row.depth}:${row.label}/ ${row.count}` : `${row.depth}:${row.file.path}`))).toEqual([
    '0:skills/react/ 2',
    '1:rules/ 1',
    '2:skills/react/rules/a.md',
    '1:skills/react/SKILL.md',
    '0:src/ui/ 1',
    '0:README.md',
  ])
  expect(shortDir('a/b/c/d')).toBe('…/c/d')
  expect(shortDir('a/b')).toBe('a/b')
})

test('FR-GR-1 to 9 the Graph tab walks the chosen refs and acts on a commit opened under its row after asking', async ($, on) => {
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
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'refresh' })
    await ui.press({ key: 'tab-graph' })
    expect(await ui.find({ key: 'tab-changes' })).toBeDefined()
    await ui.press({ key: 'graph-refresh' })

    expect(graphLogs().at(-1)).toEqual(['HEAD', 'origin/feature/scm', 'main', '--'])
    expect(await ui.find({ key: 'commit:aaa1111' })).toBeDefined()
    expect(await ui.find({ text: /Add pane/ })).toBeDefined()
    expect(await ui.find({ text: '4 commits' })).toBeDefined()
    // A local branch and its remote share one label; the checked-out one is filled.
    expect(await ui.find({ text: / feature\/scm ⇄ origin / })).toBeDefined()
    expect(await ui.find({ text: 'main ⇄ origin' })).toBeDefined()
    expect(await ui.find({ text: '2d' })).toBeDefined()
    // Lanes are text on every surface: the hollow HEAD dot and the side branch's curve are drawn.
    expect(await ui.find({ text: '○' })).toBeDefined()
    expect(await ui.find({ text: '╮' })).toBeDefined()
    // A long subject is cut to keep the row on one line; the open commit shows all of it.
    const cut = (await ui.find({ key: 'commit:bbb2222' }))?.text ?? ''
    expect(cut.startsWith('Merge pull request #2')).toBe(true)
    expect(cut.endsWith('…')).toBe(true)

    await ui.press({ key: 'commit:ddd4444' })
    expect(ran(calls, 'diff').at(-1)).toEqual(['--name-status', '-z', 'ccc3333', 'ddd4444'])
    expect((await ui.find({ key: 'file:src/a.ts' }))?.text).toContain('+5')
    expect(await ui.find({ key: 'file:src/b.ts' })).toBeDefined()
    expect(await ui.find({ text: 'Sam · 3 days ago' })).toBeDefined()

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
    expect((await ui.find({ key: 'graph-copy' }))?.text).toBe('Copied')

    // A merge is reverted against its first parent; its whole subject shows once it is open.
    await ui.press({ key: 'commit:bbb2222' })
    expect(await ui.find({ text: /a-very-long-branch-name-that-keeps-going/ })).toBeDefined()
    await ui.press({ key: 'graph-revert' })
    await ui.press({ key: 'graph-confirm' })
    expect(ran(calls, 'revert')).toEqual([['--no-edit', '-m', '1', 'bbb2222']])

    await ui.press({ key: 'graph-checkout' })
    expect(await ui.find({ text: /Check out bbb2222 with no branch\?/ })).toBeDefined()
    await ui.press({ key: 'graph-cancel' })
    expect(ran(calls, 'switch')).toEqual([['-c', 'hotfix/button', 'ddd4444']])

    await ui.select({ key: 'graph-scope', value: 'all' })
    expect(graphLogs().at(-1)).toEqual(['--branches', '--remotes', '--'])
    await ui.select({ key: 'graph-scope', value: 'remote:origin/release/2.3' })
    expect(graphLogs().at(-1)).toEqual(['HEAD', 'origin/feature/scm', 'main', 'origin/release/2.3', '--'])

    // The scope and tab are session state and outlive this drawing: put them back for the next surface.
    await ui.select({ key: 'graph-scope', value: 'auto' })
    await ui.press({ key: 'tab-changes' })
    expect(await ui.find({ key: 'commit' })).toBeDefined()
    await ui.unmount()
  }
})

test('FR-STA-1 the ⋯ menu stashes, with or without new files, and a message', async ($, on) => {
  const calls: Call[] = []
  on('process.run', fakeGit(calls, () => STATUS))

  for (const surface of SURFACES) {
    calls.length = 0
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'refresh' })

    await ui.press({ key: 'more' })
    expect((await ui.find({ key: 'stash-untracked' }))?.text).toBe('Stash all changes')
    await ui.press({ key: 'stash-push' })
    await ui.input({ key: 'prompt-text', text: 'wip login', kind: 'change' })
    await ui.press({ key: 'prompt-go' })
    expect(ran(calls, 'stash')).toEqual([['push', '-m', 'wip login']])
    expect(await ui.find({ key: 'prompt-text' })).toBeUndefined()

    await ui.press({ key: 'more' })
    await ui.press({ key: 'stash-untracked' })
    await ui.press({ key: 'prompt-go' })
    expect(ran(calls, 'stash').at(-1)).toEqual(['push', '--include-untracked'])

    await ui.unmount()
  }
})

test('FR-STA-3 the Stashes section applies, pops, and drops only after confirming', async ($, on) => {
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

test('FR-BOP-1 to 6 branch commands: create from a base, rename, merge, and delete with a second ask when unmerged', async ($, on) => {
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

    await openBranchCommands(ui)
    await ui.press({ key: 'branch-create-from' })
    // The default branch (origin/HEAD → main) is the starting base.
    expect((await ui.find({ key: 'prompt-choice' }))?.props.value).toBe('local:main')
    await ui.select({ key: 'prompt-choice', value: 'remote:origin/release/2.3' })
    await ui.input({ key: 'prompt-text', text: 'bad name', kind: 'change' })
    await ui.press({ key: 'prompt-go' })
    expect(await ui.find({ text: '“bad name” is not a valid branch name.' })).toBeDefined()
    expect(ran(calls, 'switch')).toEqual([])

    await openBranchCommands(ui)
    await ui.press({ key: 'branch-create-from' })
    await ui.select({ key: 'prompt-choice', value: 'remote:origin/release/2.3' })
    await ui.input({ key: 'prompt-text', text: 'feature/x', kind: 'submit' })
    expect(ran(calls, 'switch')).toEqual([['-c', 'feature/x', 'origin/release/2.3']])

    await openBranchCommands(ui)
    await ui.press({ key: 'branch-rename' })
    expect((await ui.find({ key: 'prompt-text' }))?.props.value).toBe('feature/scm')
    await ui.input({ key: 'prompt-text', text: 'feature/scm-v2', kind: 'submit' })
    expect(ran(calls, 'branch')).toEqual([['-m', 'feature/scm-v2']])

    await openBranchCommands(ui)
    await ui.press({ key: 'branch-merge' })
    await ui.press({ key: 'prompt-go' })
    expect(ran(calls, 'merge')).toEqual([['--no-edit', 'main']])

    await openBranchCommands(ui)
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

test('FR-COM-5 amend and undo refuse a pushed commit and work on an unpushed one', async ($, on) => {
  const calls: Call[] = []
  let isPushed = true
  on('fs.exists', async () => ({ value: false }))
  on('process.run', async (_$, e) => fakeGit(calls, () => STATUS, { isPushed })(_$, e))

  for (const surface of SURFACES) {
    calls.length = 0
    isPushed = true
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'refresh' })

    await ui.press({ key: 'commit-menu' })
    await ui.press({ key: 'commit-amend' })
    expect(await ui.find({ text: /abc1234 is already pushed/ })).toBeDefined()
    expect(ran(calls, 'commit')).toEqual([])

    isPushed = false
    await ui.press({ key: 'refresh' })
    await ui.input({ key: 'message', text: 'fix(button): better focus', kind: 'change' })
    await ui.press({ key: 'commit-menu' })
    await ui.press({ key: 'commit-amend' })
    const amended = calls.find(call => call.argv[1] === 'commit')
    expect(amended?.argv).toEqual(['git', 'commit', '--amend', '-F', '-'])
    expect(amended?.stdin).toBe('fix(button): better focus\n')

    await ui.press({ key: 'commit-menu' })
    await ui.press({ key: 'commit-undo' })
    expect(ran(calls, 'reset')).toEqual([])
    await ui.press({ key: 'undo-confirm' })
    expect(ran(calls, 'reset')).toEqual([['--soft', 'HEAD~1']])
    expect((await ui.find({ key: 'message' }))?.props.value).toBe('Add ga strings')

    await ui.unmount()
  }
})

test('FR-CHG-1 FR-MSG-2 shows changes and commits a generated message', async ($, on) => {
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
    expect((await ui.find({ key: 'commit' }))?.text).toBe('✓ Commit staged (1)')
    expect(await ui.find({ key: 'toggle:staged' })).toBeDefined()
    expect((await ui.find({ key: 'toggle:changes' }))?.text).toBe('▾ CHANGES')
    expect(await ui.find({ key: 'unstage:src/Button.tsx' })).toBeDefined()
    expect(await ui.find({ key: 'stage:notes/new file.md' })).toBeDefined()
    // A row shows the file's folder dimmed and its status letter last.
    expect((await ui.find({ key: 'changes:notes/new file.md' }))?.text).toMatch(/new file\.md.*notes.*U$/)
    expect(await ui.find({ text: 'Update en strings' })).toBeDefined()
    expect(await ui.find({ text: /you/ })).toBeDefined()
    expect(await ui.find({ text: '0/72' })).toBeDefined()

    await ui.press({ key: 'generate' })
    expect((await ui.find({ key: 'message' }))?.props.value).toBe('fix(button): keep focus ring on press\n\n- restore outline')
    expect(await ui.find({ text: '37/72' })).toBeDefined()

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

test('FR-PANE-1 FR-PANE-2 /sc-pane opens the pane on Source Control and /sc-pane-graph on Graph', async ($, on) => {
  const calls: Call[] = []
  const opened: string[] = []
  on('process.run', fakeGit(calls, () => STATUS))
  on('ui.open', async (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })

  for (const [command, shownKey] of [
    ['sc-pane-graph', 'graph-refresh'],
    ['sc-pane', 'commit'],
  ] as const) {
    opened.length = 0
    await $.command.run({
      command,
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })
    expect(opened).toEqual(['sc-pane'])

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await ui.find({ key: shownKey })).toBeDefined()
    await ui.unmount()
  }
})

test('FR-COM-2 refuses to commit without a message', async ($, on) => {
  const calls: Call[] = []
  on('process.run', fakeGit(calls, () => STATUS))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'commit' })

  expect(await ui.find({ text: /Write a message/ })).toBeDefined()
  expect(ran(calls, 'commit')).toEqual([])
  await ui.unmount()
})

test('FR-CHG-4 discards only after the question card is confirmed', async ($, on) => {
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

test('FR-REM-4 sync pulls first, then pushes what is still ahead', async ($, on) => {
  const calls: Call[] = []
  let pulled = false
  on('process.run', async (_$, e) => {
    if (e.argv[1] === 'pull') pulled = true

    return fakeGit(calls, () => status(pulled ? '+2 -0' : '+2 -3', []))(_$, e)
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ text: 'No changes. The working tree is clean.' })).toBeDefined()

  await ui.press({ key: 'sync' })
  const network = calls.map(call => call.argv[1]).filter(command => command === 'pull' || command === 'push')
  expect(network).toEqual(['pull', 'push'])
  expect(await ui.find({ text: 'Synced: pulled 3 commits, then pushed 2.' })).toBeDefined()

  // Pull and Push on their own live in the ⋯ menu.
  await ui.press({ key: 'more' })
  expect(await ui.find({ key: 'menu-pull' })).toBeDefined()
  await ui.press({ key: 'menu-push' })
  expect(calls.filter(call => call.argv[1] === 'push')).toHaveLength(2)

  // ✕ dismisses the result.
  await ui.press({ key: 'dismiss' })
  expect(await ui.find({ text: /^Pushed / })).toBeUndefined()
  await ui.unmount()
})

test('FR-CHG-5 a clean, synced tree shows the empty state and dims commit', async ($, on) => {
  const calls: Call[] = []
  on('process.run', fakeGit(calls, () => status('+0 -0', [])))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })

  expect(await ui.find({ text: 'Up to date' })).toBeDefined()
  expect(await ui.find({ key: 'fetch' })).toBeDefined()
  expect(await ui.find({ text: 'No changes. The working tree is clean.' })).toBeDefined()
  expect((await ui.find({ key: 'commit' }))?.text).toBe('✓ Nothing to commit')
  expect((await ui.find({ key: 'commit' }))?.props.dimColor).toBe(true)
  expect(await ui.find({ key: 'sync' })).toBeUndefined()

  await ui.press({ key: 'commit' })
  expect(await ui.find({ text: /Nothing to commit: the working tree is clean/ })).toBeDefined()
  expect(ran(calls, 'commit')).toEqual([])
  await ui.unmount()
})

test('FR-COM-1 FR-COM-4 Enter in the message box commits, and the commit menu commits all', async ($, on) => {
  const calls: Call[] = []
  on('process.run', fakeGit(calls, () => STATUS))
  on('fs.exists', async () => ({ value: false }))

  for (const surface of SURFACES) {
    calls.length = 0
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'refresh' })

    // A body typed under the subject goes to git as typed.
    await ui.input({ key: 'message', text: 'fix: focus ring\n\n- keep outline', kind: 'submit' })
    const first = calls.find(call => call.argv[1] === 'commit')
    expect(first?.stdin).toBe('fix: focus ring\n\n- keep outline\n')
    expect(ran(calls, 'add')).toEqual([])

    // Commit all stages the unstaged files too, although something is staged.
    await ui.input({ key: 'message', text: 'chore: everything', kind: 'change' })
    await ui.press({ key: 'commit-menu' })
    await ui.press({ key: 'commit-all' })
    expect(ran(calls, 'add')).toEqual([['-A']])
    expect(calls.filter(call => call.argv[1] === 'commit').at(-1)?.stdin).toBe('chore: everything\n')

    await ui.unmount()
  }
})

test('FR-CHG-7 the tree view groups changes by folder and stages a folder at once', async ($, on) => {
  const calls: Call[] = []
  on('process.run', fakeGit(calls, () => STATUS))

  for (const surface of SURFACES) {
    calls.length = 0
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'refresh' })

    await ui.press({ key: 'view' })
    expect(await ui.find({ key: 'toggle:changes:dir:notes' })).toBeDefined()
    expect(await ui.find({ key: 'toggle:staged:dir:src' })).toBeDefined()
    await ui.press({ key: 'stage-dir:notes' })
    expect(ran(calls, 'add')).toEqual([['--', 'notes']])

    await ui.press({ key: 'toggle:changes:dir:notes' })
    expect(await ui.find({ key: 'stage:notes/new file.md' })).toBeUndefined()
    await ui.press({ key: 'toggle:changes:dir:notes' })
    expect(await ui.find({ key: 'stage:notes/new file.md' })).toBeDefined()

    // The view is session state: put the list back for the next surface.
    await ui.press({ key: 'view' })
    expect(await ui.find({ key: 'toggle:changes:dir:notes' })).toBeUndefined()
    await ui.unmount()
  }
})

test('FR-BR-3 NFR-1 with more branches than a picker holds, lists the recent ones and searches the rest', async ($, on) => {
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

test('FR-BR-1 FR-BR-2 lists local and remote branches and switches between them', async ($, on) => {
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
