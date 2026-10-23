// Branch lists for the pickers and refs for the graph. Pure: a Repo in, options or arguments out.
import type { Repo } from '../../types'
import { GRAPH_FORMAT, SELECT_LIMIT } from '../constants'
import type { BranchOption } from '../types'
import { plural } from './text'

// Every branch as a picker option: the checked-out one first, then local, then remote, most recent first.
export function branchOptions(repo: Repo): BranchOption[] {
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

// Where Create from and Merge start: the default branch, local if it exists, else its remote, else the current one.
export function defaultBase(repo: Repo, all: BranchOption[]): string {
  if (repo.defaultBranch && all.some(option => option.value === `local:${repo.defaultBranch}`)) {
    return `local:${repo.defaultBranch}`
  }
  if (repo.defaultBranch && all.some(option => option.value === `remote:origin/${repo.defaultBranch}`)) {
    return `remote:origin/${repo.defaultBranch}`
  }

  return `local:${repo.branch}`
}

// Two fixed scopes, then branches to add to the automatic set: 64 options at most.
export function graphScopeOptions(repo: Repo): BranchOption[] {
  return [
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
