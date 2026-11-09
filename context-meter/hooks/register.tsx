import type { EngineInterface, Register, RenderInput, RenderSurface } from 'claude-code'
import { coldCache } from './cold-cache'
import { compaction } from './compact'
import { parseSettings } from './settings'
import type { Settings } from './settings'
import { k } from './text'

const BAR_CELLS = 10

type Band = Settings['band']

// Visual only: nothing acts on these. Not the `warning` theme key: VS Code paints it as
// menu text, grey; `yellow` is the editor's terminal yellow there and ANSI yellow in a
// terminal.
export const barColor = (percent: number, b: Band) =>
  percent >= b.alertPercent ? 'error' : percent >= b.warnPercent ? 'yellow' : 'success'

// The auto-compact threshold: CLAUDE_CODE_AUTO_COMPACT_WINDOW where it is set, never past
// the model's window; unset, the window itself.
async function autoCompactLimit($: EngineInterface, window: number) {
  const set = Number(await $.env.get('CLAUDE_CODE_AUTO_COMPACT_WINDOW'))
  return set > 0 ? Math.min(set, window) : window
}

// The fill against the chosen limit, then the session's estimated cost at list price,
// subagents included, left out where the host keeps no ledger. Nothing before the first
// response of a session or a compaction.
async function drawUsage($: EngineInterface, e: RenderInput, b: Band) {
  const { context: { tokens, window }, cost } = await $.session.usage()
  if (tokens === undefined) return undefined

  const limit = b.scale === 'window' ? window : await autoCompactLimit($, window)
  const percent = Math.round((tokens / limit) * 100)
  // Past 100% is real: the compact guard can skip an auto-compaction.
  const filled = Math.min(Math.round(percent / BAR_CELLS), BAR_CELLS)
  const { Text } = $.ui.resolve(e)

  return (
    <Text>
      <Text color={barColor(percent, b)}>{'▰'.repeat(filled) + '▱'.repeat(BAR_CELLS - filled)}</Text>{' '}
      <Text weight="semibold" tabular>
        {percent}%
      </Text>
      <Text dimColor>
        {' '}
        · {k(tokens)} / {k(limit)}
        {b.showCost && cost ? ` · $${cost.usd.toFixed(2)}` : ''}
      </Text>
    </Text>
  )
}

export const register: Register = (on, options) => {
  const s = parseSettings(options)
  if (s.coldCache) coldCache(on, s.language, s.coldCache)
  compaction(on, s)

  // A terminal often has a status line with the same figures, so there it is opt-in.
  const draws = (surface: RenderSurface) => surface !== 'terminal' || s.band.showInTerminal

  on('session.measure', ($, e, next) => {
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!draws(e.surface)) return next(e)
    return (await drawUsage($, e, s.band)) ?? next(e)
  })

  // The VS Code panel hides the band while a question is open, so the dialog repeats it.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const dialog = await next(e)
    if (e.surface !== 'vscode') return dialog

    const usage = await drawUsage($, e, s.band)
    if (usage === undefined) return dialog

    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" gap={1}>
        {usage}
        {dialog}
      </Box>
    )
  })
}
