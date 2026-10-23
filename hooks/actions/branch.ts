import type { EngineInterface } from 'claude-code'

import type { Repo } from '../../types'
import { failure, git, gitOrThrow, isConflict } from '../git'
import { lastLines } from '../helpers/text'
import { refresh, requireRepo, setNotice, setUi } from '../store'

// Picker values are `local:<name>` or `remote:<remote>/<name>`; git wants the bare name.
function refOf(value: string): string {
  return value.replace(/^(local|remote):/, '')
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
export async function createBranch($: EngineInterface, name: string, base?: string) {
  const repo = await requireRepo($)
  const branch = await validBranchName($, repo, name)
  const start = base === undefined ? undefined : refOf(base)

  await gitOrThrow($, ['switch', '-c', branch, ...(start ? [start] : [])], { cwd: repo.root })

  await setNotice($, 'ok', `Created ${branch}${start ? ` from ${start}` : ''}, and switched to it.`)
  await refresh($)
}

export async function renameBranch($: EngineInterface, name: string) {
  const repo = await requireRepo($)
  if (repo.branch === 'detached HEAD') throw new Error('No branch is checked out to rename.')
  const branch = await validBranchName($, repo, name)

  await gitOrThrow($, ['branch', '-m', branch], { cwd: repo.root })

  await setNotice($, 'ok', `Renamed ${repo.branch} to ${branch}.${repo.upstream ? ' Its upstream is unchanged.' : ''}`)
  await refresh($)
}

// `-d` first; when git says the branch is not merged, the pane asks again before `-D`.
export async function deleteBranch($: EngineInterface, name: string, force: boolean) {
  const repo = await requireRepo($)
  const deleted = await git($, ['branch', force ? '-D' : '-d', name], { cwd: repo.root })
  if (deleted.exitCode !== 0) {
    if (!force && /not fully merged/.test(deleted.stderr)) {
      await setUi($, { more: null, prompt: { kind: 'forceDelete', text: '', choice: name } })
      return
    }
    throw new Error(failure(deleted))
  }

  await setNotice($, 'ok', `Deleted ${name}.`)
  await refresh($)
}

export async function mergeBranch($: EngineInterface, value: string) {
  const name = refOf(value)
  const repo = await requireRepo($)
  const merged = await git($, ['merge', '--no-edit', name], { cwd: repo.root })
  await refresh($)
  if (merged.exitCode !== 0) {
    if (isConflict(merged)) {
      throw new Error(`Merging ${name} stopped on conflicts: resolve the files marked !, stage them, then commit.`)
    }
    throw new Error(failure(merged))
  }

  await setNotice($, 'ok', lastLines(merged.stdout, 1) || `Merged ${name} into ${repo.branch}.`)
}

// Values of the branch picker: `local:<name>`, `remote:<remote>/<name>`, or `detached`.
export async function switchBranch($: EngineInterface, value: string) {
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
  await gitOrThrow($, args, { cwd: repo.root })

  await setNotice($, 'ok', done)
  await refresh($)
}
