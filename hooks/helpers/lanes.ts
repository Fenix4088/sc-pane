// Graph lanes: which column each commit sits in, and how a row of lanes is drawn as text.
import type { GraphCommit } from '../../types'
import { GLYPHS, LANE_TONES, MAX_LANES } from '../constants'
import type { LaneCell, LaneRow, LaneSegment } from '../types'

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

    return {
      hash: commit.hash,
      col,
      isMerge: others.length > 0,
      isHead: commit.refs.some(ref => ref === 'HEAD' || ref.startsWith('HEAD →')),
      segments,
      width: Math.max(before.length, after.length, col + 1),
    }
  })
}

// The lanes whose line leaves the row downwards: what the open commit's panel under it carries on drawing.
export function lanesBelow(row: LaneRow): number[] {
  const lanes = row.segments.flatMap(segment =>
    segment.half === 'full' ? [segment.from] : segment.half === 'bottom' ? [segment.to] : [],
  )

  return [...new Set(lanes)].sort((a, b) => a - b)
}

// The lane block of one line of the open commit's panel: a straight line on each lane that carries on below.
export function continuingCells(row: LaneRow, lanes: number): LaneCell[] {
  const below = new Set(lanesBelow(row))

  return Array.from({ length: Math.min(lanes, MAX_LANES) }, (_, lane) => ({
    glyph: below.has(lane) ? '│' : ' ',
    glyphLane: lane,
    joint: ' ',
    jointLane: lane,
  }))
}

export function laneTone(lane: number): string {
  return LANE_TONES[lane % LANE_TONES.length] ?? '#8AA0B4'
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
    const glyph = lane === row.col ? (row.isHead ? '○' : '●') : (GLYPHS[key] ?? ' ')
    const glyphLane = lane === row.col ? row.col : at.upright >= 0 ? at.upright : at.across

    return { glyph, glyphLane: Math.max(glyphLane, 0), joint: at.right ? '─' : ' ', jointLane: Math.max(at.across, 0) }
  })
}
