import type { EngineInterface, ProcessRunResult } from 'claude-code'

import { GIT_ENV } from './constants'
import { lastLines } from './helpers/text'
import type { RunInit } from './types'

// Every git call goes through here, so none can wait on a prompt or an editor (BR-3).
export function git($: EngineInterface, args: string[], init: RunInit = {}): Promise<ProcessRunResult> {
  return $.process.run(['git', ...args], { env: GIT_ENV, ...init })
}

export function failure(result: ProcessRunResult): string {
  const text = lastLines(result.stderr || result.stdout, 8)

  return text || `git exited with code ${result.exitCode}`
}

// Runs git and throws git's own words when it fails.
export async function gitOrThrow($: EngineInterface, args: string[], init: RunInit = {}): Promise<ProcessRunResult> {
  const result = await git($, args, init)
  if (result.exitCode !== 0) throw new Error(failure(result))

  return result
}

export async function userEmail($: EngineInterface, cwd: string): Promise<string> {
  return (await git($, ['config', 'user.email'], { cwd })).stdout.trim().toLowerCase()
}

export function isConflict(result: ProcessRunResult): boolean {
  return /CONFLICT/.test(result.stdout + result.stderr)
}
