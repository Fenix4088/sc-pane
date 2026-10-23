// Presentation helpers: colours, labels and icons the components draw. Pure, no `$`.
import type { ElementTable } from 'claude-code'

import type { Repo } from '../../types'
import { TONE } from '../constants'
import type { Kit, SyncLine } from '../types'
import { plural } from './text'

// Picks the elements a component needs from the surface's table; the optional ones are absent where unsupported.
export function toKit(elements: ElementTable): Kit {
  return {
    Box: elements.Box,
    Text: elements.Text,
    Button: elements.Button,
    Input: 'Input' in elements ? elements.Input : undefined,
    Select: 'Select' in elements ? elements.Select : undefined,
    Svg: 'Svg' in elements ? elements.Svg : undefined,
  }
}

export function svg(paths: string, stroke: string, size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
}

export function dot(fill: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3.5" fill="${fill}"/></svg>`
}

export function codeColor(code: string): string {
  if (code === 'A' || code === 'U') return 'success'
  if (code === 'D' || code === '!') return 'error'
  if (code === 'R' || code === 'C') return 'suggestion'

  return 'warning'
}

export function syncLine(repo: Repo): SyncLine {
  if (!repo.upstream) return { text: 'Not published yet', color: 'inactive', dot: TONE.muted }
  if (repo.ahead > 0 && repo.behind > 0) return { text: 'Diverged from', color: 'warning', dot: TONE.amber }
  if (repo.ahead > 0) return { text: 'Ahead of', color: 'suggestion', dot: TONE.blue }
  if (repo.behind > 0) return { text: 'Behind', color: 'suggestion', dot: TONE.blue }

  return { text: 'Up to date with', color: 'inactive', dot: TONE.green }
}

export function syncHint(repo: Repo): string {
  if (repo.behind > 0 && repo.ahead > 0) return `Sync pulls ${plural(repo.behind, 'commit')}, then pushes your ${repo.ahead}.`
  if (repo.behind > 0) return `Sync pulls ${plural(repo.behind, 'commit')}.`

  return `Sync pushes your ${plural(repo.ahead, 'commit')}.`
}

// Why amend and undo cannot run, or null when they can (BR-2).
export function rewriteBlock(repo: Repo): string | null {
  const last = repo.lastCommit
  if (!last) return 'There is no commit yet.'
  if (last.isPushed) return `${last.hash} is already pushed: changing it would rewrite shared history.`

  return null
}
