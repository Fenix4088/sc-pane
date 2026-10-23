import type { Draft } from '../../types'
import { SUBJECT_CHARS } from '../constants'

// A label holding a control character (a tab in a subject, say) is refused, and with it the whole pane.
export function printable(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

export function lastLines(text: string, count: number): string {
  return text.trim().split(/\r?\n/).slice(-count).join('\n')
}

export function shortSubject(subject: string, limit = SUBJECT_CHARS): string {
  return subject.length > limit ? `${subject.slice(0, limit - 1).trimEnd()}…` : subject
}

// A label cut in the middle, so both ends of a long branch name stay readable.
export function middleCut(text: string, limit: number): string {
  if (text.length <= limit) return text
  const head = Math.ceil((limit - 1) / 2)

  return `${text.slice(0, head)}…${text.slice(text.length - (limit - 1 - head))}`
}

// A folder as a file row shows it: its last two names, with `…/` for the rest.
export function shortDir(dir: string): string {
  const names = dir.split('/')

  return names.length > 2 ? `…/${names.slice(-2).join('/')}` : dir
}

const AGE_UNITS: [RegExp, string][] = [
  [/^second/, 's'],
  [/^minute/, 'm'],
  [/^hour/, 'h'],
  [/^day/, 'd'],
  [/^week/, 'w'],
  [/^month/, 'mo'],
  [/^year/, 'y'],
]

// git's relative date (`12 minutes ago`, `1 year, 2 months ago`) as a graph row shows it: `12m`, `1y`.
export function shortAge(when: string): string {
  const match = /^(\d+)\s+([a-z]+)/.exec(when.trim())
  const unit = match ? AGE_UNITS.find(([pattern]) => pattern.test(match[2] ?? '')) : undefined

  return match && unit ? `${match[1]}${unit[1]}` : when
}

// Breaks text into lines of at most `width` characters at spaces; a word longer than a line is cut.
export function wrapText(text: string, width: number): string[] {
  const room = Math.max(8, width)
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let rest = word
    while (rest.length > room) {
      if (line) lines.push(line)
      lines.push(rest.slice(0, room))
      line = ''
      rest = rest.slice(room)
    }
    if (!line) line = rest
    else if (line.length + 1 + rest.length <= room) line = `${line} ${rest}`
    else {
      lines.push(line)
      line = rest
    }
  }
  if (line) lines.push(line)

  return lines.length > 0 ? lines : ['']
}

// The message box's text from the draft, and back: `draftOf(messageText(draft))` keeps what was typed.
export function messageText(draft: Draft): string {
  if (!draft.body) return draft.subject

  return draft.body.startsWith('\n') ? `${draft.subject}${draft.body}` : `${draft.subject}\n\n${draft.body}`
}

export function draftOf(text: string): Draft {
  const at = text.indexOf('\n')

  return at < 0 ? { subject: text, body: '' } : { subject: text.slice(0, at), body: text.slice(at) }
}

export function splitPath(path: string): { name: string; dir: string } {
  const slash = path.lastIndexOf('/')

  return slash < 0 ? { name: path, dir: '' } : { name: path.slice(slash + 1), dir: path.slice(0, slash) }
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
