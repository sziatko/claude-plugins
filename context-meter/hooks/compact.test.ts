import { expect, test } from 'claude-code/testing'

const WINDOW = 1_000_000
// A compaction leaves at least one message.
const MESSAGES = [{ role: 'user', text: 'Fix the parser', toolUses: [] }]
const COMPACTED = { messages: MESSAGES }
const GUARD = { options: { compact_guard: true } }

// Stands for the engine beneath the plugin: the context size, git and the compaction.
function engine(on: any, { tokens, git }: { tokens: number; git: { exitCode: number; stdout: string; stderr?: string } }) {
  const seen = { compacted: 0 }
  on('session.usage', () => ({ value: { context: { tokens, window: WINDOW } } }))
  on('process.run', () => ({
    value: { stderr: '', ...git, isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('session.compact', () => {
    seen.compacted++
    return COMPACTED
  })
  return seen
}

const DIRTY = { exitCode: 0, stdout: ' M src/a.ts\n?? src/b.ts\n' }
const compact = ($: any, trigger = 'auto') => $.session.compact({ trigger, messages: MESSAGES })

test('off by default: an auto-compaction runs', async ($, on) => {
  const seen = engine(on, { tokens: 300_000, git: DIRTY })
  await compact($)
  expect(seen.compacted).toBe(1)
})

test('uncommitted work skips an auto-compaction', GUARD, async ($, on) => {
  const seen = engine(on, { tokens: 300_000, git: DIRTY })
  expect(await compact($)).toEqual({
    skip: 'Auto-compact skipped: work in progress (2 uncommitted files), context 300k.',
  })
  expect(seen.compacted).toBe(0)
})

test('a clean tree compacts', GUARD, async ($, on) => {
  const seen = engine(on, { tokens: 300_000, git: { exitCode: 0, stdout: '' } })
  await compact($)
  expect(seen.compacted).toBe(1)
})

test('outside a git repository it compacts', GUARD, async ($, on) => {
  const seen = engine(on, {
    tokens: 300_000,
    git: { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git' },
  })
  await compact($)
  expect(seen.compacted).toBe(1)
})

test('past the ceiling it always compacts', GUARD, async ($, on) => {
  const seen = engine(on, { tokens: 600_001, git: DIRTY })
  await compact($)
  expect(seen.compacted).toBe(1)
})

test('the ceiling is a setting', { options: { compact_guard: true, compact_guard_max_percent: 20 } }, async ($, on) => {
  const seen = engine(on, { tokens: 300_000, git: DIRTY })
  await compact($)
  expect(seen.compacted).toBe(1)
})

test('a /compact the person asked for is never skipped', GUARD, async ($, on) => {
  const seen = engine(on, { tokens: 300_000, git: DIRTY })
  await compact($, 'manual')
  expect(seen.compacted).toBe(1)
})

test('after a compaction Claude is given the note', async ($, on) => {
  on('classic.SessionStart', () => ({}))
  const result = await $.classic.SessionStart({ source: 'compact' })
  expect(result.additionalContext).toEqual([
    'The context was just compacted. Before continuing, re-read the task you were on and run git diff --stat.',
  ])
})

test('an empty note says nothing', { options: { after_compact_note: '  ' } }, async ($, on) => {
  on('classic.SessionStart', () => ({}))
  const result = await $.classic.SessionStart({ source: 'compact' })
  expect(result.additionalContext).toBeUndefined()
})

test('a session that did not compact gets no note', async ($, on) => {
  on('classic.SessionStart', () => ({}))
  const result = await $.classic.SessionStart({ source: 'startup' })
  expect(result.additionalContext).toBeUndefined()
})
