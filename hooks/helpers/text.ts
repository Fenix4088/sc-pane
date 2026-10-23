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

export function shortSubject(subject: string): string {
  return subject.length > SUBJECT_CHARS ? `${subject.slice(0, SUBJECT_CHARS - 1).trimEnd()}…` : subject
}

export function splitPath(path: string): { name: string; dir: string } {
  const slash = path.lastIndexOf('/')

  return slash < 0 ? { name: path, dir: '' } : { name: path.slice(slash + 1), dir: path.slice(0, slash) }
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
