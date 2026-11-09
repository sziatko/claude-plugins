import type { EngineInterface, On } from 'claude-code'
import type { Settings } from './settings'
import { TEXT } from './text'

// Uncommitted paths in the session's working directory; outside a git repository there
// is no work in progress to protect.
async function uncommitted($: EngineInterface) {
  const { exitCode, stdout, stderr } = await $.process.run(['git', 'status', '--porcelain'])
  if (exitCode !== 0) {
    if (/not a git repository/i.test(stderr)) return 0
    throw new Error(`git status exited ${exitCode}: ${stderr}`)
  }
  return stdout.split('\n').filter(Boolean).length
}

export function compaction(on: On, s: Settings) {
  const guard = s.compactGuard
  if (guard) {
    // Skips an auto-compaction while uncommitted changes say a step is in progress.
    on('session.compact', { trigger: 'auto' }, async ($, e, next) => {
      if (e.agentId !== undefined) return next(e)
      const { tokens, window } = (await $.session.usage()).context
      // Past this share an auto-compaction may be the engine's answer to a prompt that no
      // longer fits: blocked, that request fails.
      if (tokens === undefined || tokens > (window * guard.maxPercent) / 100) return next(e)
      const files = await uncommitted($)
      if (files === 0) return next(e)
      return { skip: TEXT[s.language].compactSkipped(files, tokens) }
    })
  }

  const note = s.afterCompactNote
  if (note) {
    on('classic.SessionStart', { source: 'compact' }, async ($, e, next) => {
      const result = await next(e)
      return { ...result, additionalContext: [...(result.additionalContext ?? []), note] }
    })
  }
}
