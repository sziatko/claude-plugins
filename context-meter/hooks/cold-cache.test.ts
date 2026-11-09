import { expect, test } from 'claude-code/testing'
import { handoffText } from './cold-cache'

const STEP = { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3 }
const SENT = { turnId: 't1', index: 0, answer: 'sent', toolUses: [], stopReason: 'end_turn', usage: null }
// What meter.js prints for `cold` when the cache expired.
const COLD = JSON.stringify({ idleMin: 75, ttlMin: 60, tokens: 150_000, writePrice: 2 })

// Stands for the engine beneath the plugin. `cold` is what meter.js prints for `cold`;
// `choice` the label the person picks, or undefined for a dismissed dialog.
function engine(on: any, { cold, choice, surfaces = ['vscode'] }: any) {
  const seen = {
    asked: [] as string[],
    headers: [] as string[],
    meterArgs: [] as string[][],
    requests: 0,
    aborted: [] as string[],
    copied: [] as string[],
    logged: [] as string[],
  }
  on('classic.SessionStart', () => ({}))
  on('session.surfaces', () => ({ value: surfaces }))
  on('process.run', (_: unknown, e: any) => {
    seen.meterArgs.push(e.argv.slice(2))
    return {
      value: {
        exitCode: 0,
        stdout: cold,
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_: unknown, e: any) => {
    const [{ question: asked }] = e.questions
    seen.asked.push(asked)
    seen.headers.push(e.questions[0].header)
    if (choice === undefined) throw new Error('dismissed')
    return { result: { questions: e.questions, answers: { [asked]: choice } } }
  })
  on('turn.abort', (_: unknown, e: any) => {
    seen.aborted.push(e.turnId)
    return { value: undefined }
  })
  on('session.id', () => ({ value: 's1' }))
  on('ui.copy', (_: unknown, e: any) => {
    seen.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.log', (_: unknown, e: any) => {
    seen.logged.push(e.text)
    return { value: undefined }
  })
  on('turn.step', async function* () {
    seen.requests++
    yield* []
    return SENT
  })
  return seen
}

async function step($: any, input: object = STEP) {
  const stream = $.turn.step(input)
  let read = await stream.next()
  while (!read.done) read = await stream.next()
  return read.value
}

const session = ($: any) => $.classic.SessionStart({ source: 'startup', transcript_path: '/t/s1.jsonl' })

test('a warm cache sends the request without a question', async ($, on) => {
  const seen = engine(on, { cold: '' })
  await session($)
  expect((await step($)).answer).toBe('sent')
  expect(seen.asked).toEqual([])
})

test('the size threshold reaches meter.js', { options: { cold_cache_min_tokens: 250_000 } }, async ($, on) => {
  const seen = engine(on, { cold: '' })
  await session($)
  await step($)
  expect(seen.meterArgs).toEqual([['cold', '/t/s1.jsonl', '250000']])
})

test('a cold cache asks, and Continue sends the request', async ($, on) => {
  const seen = engine(on, { cold: COLD, choice: 'Continue here' })
  await session($)
  expect((await step($)).answer).toBe('sent')
  expect(seen).toMatchObject({ requests: 1, aborted: [], headers: ['Cold cache'] })
  expect(seen.asked[0]).toBe(
    'The cache is cold: idle 75 min, the cache lives 60 min, context 150k. This request writes the whole ' +
      'context to the cache again at ×2 the input price instead of ×0.1 for a read. What now?',
  )
})

test('the question speaks the chosen language', { options: { language: 'uk' } }, async ($, on) => {
  const seen = engine(on, { cold: COLD, choice: 'Продовжити тут' })
  await session($)
  expect((await step($)).answer).toBe('sent')
  expect(seen.asked[0]).toMatch(/^Кеш холодний: простій 75 хв, кеш живе 60 хв, контекст 150k\..*×2 /)
  expect(seen.headers).toEqual(['Холодний кеш'])
})

test('Stop sends nothing and ends the turn', async ($, on) => {
  const seen = engine(on, { cold: COLD, choice: 'Stop' })
  await session($)
  expect((await step($)).answer).toBe('')
  expect(seen).toMatchObject({ requests: 0, aborted: ['t1'] })
})

test('a dismissed question spends nothing either', async ($, on) => {
  const seen = engine(on, { cold: COLD, choice: undefined })
  await session($)
  await step($)
  expect(seen).toMatchObject({ requests: 0, aborted: ['t1'] })
})

test('the handoff points at the transcript, and the request is not sent', async ($, on) => {
  const seen = engine(on, { cold: COLD, choice: 'Copy for a new session' })
  await session($)
  await step($)
  expect(seen.requests).toBe(0)
  expect(seen.copied[0]).toContain('session s1')
  expect(seen.copied[0]).toContain('Its transcript: /t/s1.jsonl')
  expect(seen.copied[0]).toMatch(/\n\nFirst run git status/)
  expect(seen.logged[0]).toMatch(/^Copied for a new session/)
})

test('the handoff closes with the steps set', { options: { handoff_steps: 'Read docs/plan.md first.' } }, async ($, on) => {
  const seen = engine(on, { cold: COLD, choice: 'Copy for a new session' })
  await session($)
  await step($)
  expect(seen.copied[0]).toMatch(/\n\nRead docs\/plan\.md first\.$/)
})

test('a request soon after the last one is not checked again', async ($, on) => {
  const seen = engine(on, { cold: COLD, choice: 'Continue here' })
  await session($)
  await step($)
  await step($)
  expect(seen).toMatchObject({ requests: 2 })
  expect(seen.asked).toHaveLength(1)
})

test('a subagent, a -p run and an unknown transcript are never asked', async ($, on) => {
  const seen = engine(on, { cold: COLD, choice: 'Stop', surfaces: [] })
  await step($)
  await session($)
  await step($)
  await step($, { ...STEP, agentId: 'a1' })
  expect(seen).toMatchObject({ asked: [], requests: 3 })
})

test('turned off, nothing is checked', { options: { cold_cache_check: false } }, async ($, on) => {
  const seen = engine(on, { cold: COLD, choice: 'Stop' })
  await session($)
  await step($)
  expect(seen).toMatchObject({ asked: [], meterArgs: [], requests: 1 })
})

test('with no steps set the handoff is the pointer alone', () => {
  const text = handoffText('uk', '', { sessionId: 's1', transcriptPath: '/t/s1.jsonl' })
  expect(text.split('\n\n')).toHaveLength(2)
  expect(text).toContain('сесії Claude Code s1')
  expect(text).toContain('транскрипт: /t/s1.jsonl')
})
