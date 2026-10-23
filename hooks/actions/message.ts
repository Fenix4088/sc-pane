// ✦ Generate: a commit message written by the model from the diff (FR-MSG-*).
import type { EngineInterface } from 'claude-code'

import { COMMITLINT_CONFIGS, DIFF_BUDGET, UNTRACKED_FILE_BUDGET } from '../constants'
import { failure, git } from '../git'
import { parseMessage } from '../helpers/parse'
import { requireRepo, setDraft, setNotice } from '../store'
import type { Settings } from '../types'

async function commitRules($: EngineInterface, root: string): Promise<string | null> {
  for (const name of COMMITLINT_CONFIGS) {
    const path = `${root}/${name}`
    if (await $.fs.exists(path)) {
      const text = await $.fs.read(path)

      return `${name}:\n${text.slice(0, 4_000)}`
    }
  }

  return null
}

function systemPrompt(settings: Settings): string {
  return [
    'You write git commit messages. Reply with the commit message only: no preamble, no quotes, no code fences.',
    'First line: a subject of at most 72 characters in the imperative mood, describing what the change does.',
    settings.includeBody
      ? 'When the change is more than a one-liner, add a blank line and a short body (wrapped at 72 characters) saying what changed and why. Use "-" bullets for several distinct changes. Skip the body for trivial changes.'
      : 'Write the subject line only, no body.',
    'Follow the repository convention shown by its recent commit subjects and its commitlint config when one is given: same type prefixes, scopes and casing. When a scope is required, pick the area most of the change touches.',
  ].join('\n')
}

export async function generate($: EngineInterface, settings: Settings) {
  const repo = await requireRepo($)

  const useStaged = repo.staged.length > 0
  if (!useStaged && repo.unstaged.length === 0) throw new Error('No changes to describe.')

  const cwd = repo.root
  const scope = useStaged ? ['--cached'] : []
  const stat = await git($, ['diff', ...scope, '--stat', '--no-color'], { cwd })
  const diff = await git($, ['diff', ...scope, '--no-color', '--no-ext-diff', '-U3'], { cwd })
  if (diff.exitCode !== 0) throw new Error(failure(diff))

  let budget = DIFF_BUDGET
  let diffText = diff.stdout
  if (diffText.length > budget) {
    diffText = `${diffText.slice(0, budget)}\n[diff cut at ${budget} characters]`
  }
  budget -= diffText.length

  const untracked = useStaged ? [] : repo.unstaged.filter(file => file.code === 'U')
  const newFiles: string[] = []
  for (const file of untracked) {
    if (budget <= 0) {
      newFiles.push(`${file.path} (content not shown)`)
      continue
    }
    try {
      const text = (await $.fs.read(`${cwd}/${file.path}`)).slice(0, Math.min(UNTRACKED_FILE_BUDGET, budget))
      budget -= text.length
      newFiles.push(`--- new file: ${file.path}\n${text}`)
    } catch {
      newFiles.push(`${file.path} (binary or unreadable)`)
    }
  }

  const log = await git($, ['log', '-n', '15', '--format=%s'], { cwd })
  const recent = log.exitCode === 0 ? log.stdout.trim() : ''
  const rules = await commitRules($, cwd)

  const prompt = [
    rules ? `Commit lint rules (${rules})` : null,
    recent ? `Recent commit subjects:\n${recent}` : null,
    `Changes to describe (${useStaged ? 'staged' : 'working tree'}):\n${stat.stdout.trim()}`,
    diffText.trim() ? `Diff:\n${diffText}` : null,
    newFiles.length > 0 ? `New untracked files:\n${newFiles.join('\n\n')}` : null,
  ]
    .filter(part => part !== null)
    .join('\n\n')

  const reply = await $.model.complete({
    model: settings.model,
    system: systemPrompt(settings),
    prompt,
    maxTokens: 800,
    effort: 'low',
    timeoutMs: 90_000,
  })
  if (!reply.isAnswered) {
    throw new Error(
      reply.reason === 'api-error'
        ? `The model call failed (${reply.error}${reply.status ? `, HTTP ${reply.status}` : ''}).`
        : `The model gave no message (${reply.reason}).`,
    )
  }

  const draft = parseMessage(reply.text)
  if (!draft.subject) throw new Error('The model returned an empty message.')

  await setDraft($, () => draft)
  await setNotice($, 'ok', `Message written from the ${useStaged ? 'staged' : 'working tree'} changes.`)
}
