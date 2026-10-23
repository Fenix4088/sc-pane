// Presentation helpers: colours, labels and icons the components draw. Pure, no `$`.
import type { ElementTable, RenderSurface } from 'claude-code'

import type { Repo } from '../../types'
import type { Kit } from '../types'

// Picks the elements a component needs from the surface's table; the optional ones are absent where unsupported.
// The engine completes every table with stand-ins that draw nothing, so the surface decides, not the table: the
// terminal has no Svg, mobile no Input or Select, and their components then draw their text fallbacks.
export function toKit(elements: ElementTable, surface: RenderSurface): Kit {
  return {
    isDesktop: surface === 'desktop',
    Box: elements.Box,
    Text: elements.Text,
    Button: elements.Button,
    Input: surface !== 'mobile' && 'Input' in elements ? elements.Input : undefined,
    Select: surface !== 'mobile' && 'Select' in elements ? elements.Select : undefined,
    Svg: surface !== 'terminal' && 'Svg' in elements ? elements.Svg : undefined,
  }
}

export function svg(paths: string, stroke: string, size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
}

export function codeColor(code: string): string {
  if (code === 'A' || code === 'U') return 'success'
  if (code === 'D' || code === '!') return 'error'
  if (code === 'R' || code === 'C') return 'suggestion'

  return 'warning'
}

// Why amend and undo cannot run, or null when they can (BR-2).
export function rewriteBlock(repo: Repo): string | null {
  const last = repo.lastCommit
  if (!last) return 'There is no commit yet.'
  if (last.isPushed) return `${last.hash} is already pushed: changing it would rewrite shared history.`

  return null
}
