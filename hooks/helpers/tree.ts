// The changed files as a folder tree, as the Source Control pane's tree view lists them. Pure.
import type { FileChange } from '../../types'
import type { TreeRow } from '../types'
import { splitPath } from './text'

// Only folders that hold a changed file directly get a row, nested under the nearest such folder above them,
// so a chain of folders with nothing else in them reads as one row (`src/ui/panes`). Files at the root come last.
export function fileTree(files: FileChange[], isOpen: (dir: string) => boolean): TreeRow[] {
  const dirOf = (file: FileChange) => splitPath(file.path).dir
  const dirs = [...new Set(files.map(dirOf).filter(Boolean))].sort()
  const parentOf = (dir: string) =>
    dirs.reduce((best, other) => (other !== dir && dir.startsWith(`${other}/`) && other.length > best.length ? other : best), '')

  const rows: TreeRow[] = []
  const walk = (dir: string, depth: number) => {
    const parent = parentOf(dir)
    const count = files.filter(file => file.path.startsWith(`${dir}/`)).length
    rows.push({ kind: 'folder', dir, label: parent ? dir.slice(parent.length + 1) : dir, depth, count })
    if (!isOpen(dir)) return

    dirs.filter(child => parentOf(child) === dir).forEach(child => walk(child, depth + 1))
    files.filter(file => dirOf(file) === dir).forEach(file => rows.push({ kind: 'file', file, depth: depth + 1 }))
  }

  dirs.filter(dir => !parentOf(dir)).forEach(dir => walk(dir, 0))
  files.filter(file => !dirOf(file)).forEach(file => rows.push({ kind: 'file', file, depth: 0 }))

  return rows
}
