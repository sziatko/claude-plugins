import { expect, test } from 'claude-code/testing'
import { handoffText } from './cold-cache'

const STEP = { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3 }
const SENT = { turnId: 't1', index: 0, answer: 'sent', toolUses: [], stopReason: 'end_turn', usage: null }
// What meter.js finds about a cold cache.
const COLD = { idleMin: 75, ttlMin: 60, tokens: 150_000, writePrice: 2 }
const PATH = '/t/s1.jsonl'

type Options = {
  // What meter.js reports for `cold`: the cold cache, or null for a warm one.
  cold: typeof COLD | null
  // The labels the person picks, one per question; undefined dismisses the dialog.
  choices?: (string | undefined)[]
  surfaces?: string[]
  // What an earlier worker or session left in the plugin's store.
  stored?: Record<string, unknown>
  meterFails?: boolean
}

// Stands for the engine beneath the plugin. `cold` and `surfaces` may change between steps.
function engine(on: any, { cold, choices = [], surfaces = ['vscode'], stored = {}, meterFails = false }: Options) {
  const seen = {
    cold,
    surfaces,
    asked: [] as string[],
    headers: [] as string[],
    meterArgs: [] as string[][],
    requests: 0,
    aborted: [] as string[],
    copied: [] as string[],
    logged: [] as string[],
    notified: [] as string[],
    store: new Map(Object.entries(stored)),
  }
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('session.surfaces', () => ({ value: seen.surfaces }))
  on('store.get', (_: unknown, e: any) => ({ value: seen.store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => {
    seen.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('process.run', (_: unknown, e: any) => {
    const args = e.argv.slice(2)
    seen.meterArgs.push(args)
    const stdout = args[0] === 'path' ? PATH : JSON.stringify({ transcriptPath: PATH, cold: seen.cold })
    return {
      value: {
        exitCode: meterFails ? 1 : 0,
        stdout: meterFails ? '' : stdout,
        stderr: meterFails ? 'no transcript' : '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_: unknown, e: any) => {
    const [{ question: asked }] = e.questions
    seen.asked.push(asked)
    seen.headers.push(e.questions[0].header)
    const choice = choices.shift()
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
  on('ui.notify', (_: unknown, e: any) => {
    seen.notified.push(e.text)
    return { value: { isSent: true, channel: 'iterm2' } }
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

test('a warm cache sends the request without a question', async ($, on) => {
  const seen = engine(on, { cold: null })
  expect((await step($)).answer).toBe('sent')
  expect(seen.asked).toEqual([])
})

test('the session and the size threshold reach meter.js', { options: { cold_cache_min_tokens: 250_000 } }, async ($, on) => {
  const seen = engine(on, { cold: null })
  await step($)
  expect(seen.meterArgs).toEqual([['cold', 's1', '250000']])
})

test('a cold cache asks, and Continue sends the request', async ($, on) => {
  const seen = engine(on, { cold: COLD, choices: ['Continue here'] })
  expect((await step($)).answer).toBe('sent')
  expect(seen).toMatchObject({ requests: 1, aborted: [], headers: ['Cold cache'] })
  expect(seen.asked[0]).toBe(
    'The cache is cold: idle 75 min, the cache lives 60 min, context 150k. This request writes the whole ' +
      'context to the cache again at ×2 the input price instead of ×0.1 for a read. What now?',
  )
})

test('the question speaks the chosen language', { options: { language: 'uk' } }, async ($, on) => {
  const seen = engine(on, { cold: COLD, choices: ['Продовжити тут'] })
  expect((await step($)).answer).toBe('sent')
  expect(seen.asked[0]).toMatch(/^Кеш холодний: простій 75 хв, кеш живе 60 хв, контекст 150k\..*×2 /)
  expect(seen.headers).toEqual(['Холодний кеш'])
})

test('Stop sends nothing and ends the turn', async ($, on) => {
  const seen = engine(on, { cold: COLD, choices: ['Stop'] })
  expect((await step($)).answer).toBe('')
  expect(seen).toMatchObject({ requests: 0, aborted: ['t1'] })
})

test('a dismissed question spends nothing either', async ($, on) => {
  const seen = engine(on, { cold: COLD })
  await step($)
  expect(seen).toMatchObject({ requests: 0, aborted: ['t1'] })
})

test('the handoff points at the transcript, and the request is not sent', async ($, on) => {
  const seen = engine(on, { cold: COLD, choices: ['Copy for a new session'] })
  await step($)
  expect(seen.requests).toBe(0)
  expect(seen.copied[0]).toContain('session s1')
  expect(seen.copied[0]).toContain(`Its transcript: ${PATH}`)
  expect(seen.copied[0]).toMatch(/\n\nFirst run git status/)
  expect(seen.logged[0]).toMatch(/^Copied for a new session/)
})

test('the handoff closes with the steps set', { options: { handoff_steps: 'Read docs/plan.md first.' } }, async ($, on) => {
  const seen = engine(on, { cold: COLD, choices: ['Copy for a new session'] })
  await step($)
  expect(seen.copied[0]).toMatch(/\n\nRead docs\/plan\.md first\.$/)
})

test('a request soon after the last one is not checked again', async ($, on) => {
  const seen = engine(on, { cold: COLD, choices: ['Continue here'] })
  await step($)
  await step($)
  expect(seen).toMatchObject({ requests: 2 })
  expect(seen.asked).toHaveLength(1)
})

test('after a handoff every later request asks again until Continue', async ($, on) => {
  // The handoff, then turns a task notification starts while the person is in the new session.
  const seen = engine(on, { cold: COLD, choices: ['Copy for a new session', undefined, 'Stop', 'Continue here'] })
  await step($)
  await step($)
  await step($)
  expect(seen.requests).toBe(0)
  expect((await step($)).answer).toBe('sent')
  expect(seen.asked).toHaveLength(4)
})

test('a held session asks again even when the cache reads warm', async ($, on) => {
  const seen = engine(on, { cold: COLD, choices: ['Stop', 'Continue here'] })
  await step($)
  seen.cold = null
  expect((await step($)).answer).toBe('sent')
  expect(seen.asked[1]).toBe('This session is on hold: you left it for a new session or stopped it. Continue here?')
})

test('Continue releases the hold', async ($, on) => {
  const seen = engine(on, { cold: COLD, choices: ['Stop', 'Continue here'] })
  await step($)
  await step($)
  seen.cold = null
  await step($)
  expect(seen).toMatchObject({ requests: 2 })
  expect(seen.asked).toHaveLength(2)
})

test('a hold outlives the worker: it is read back from the store', async ($, on) => {
  const seen = engine(on, { cold: null, stored: { 'session:s1': { attached: true, held: true } }, choices: ['Stop'] })
  await step($)
  expect(seen).toMatchObject({ requests: 0, aborted: ['t1'] })
  expect(seen.asked).toHaveLength(1)
})

test('a session drawn once and hidden now asks before a cold request', async ($, on) => {
  // An earlier worker saw the panel; now the person is in another session.
  const seen = engine(on, { cold: COLD, stored: { 'session:s1': { attached: true, held: false } }, surfaces: [] })
  await step($)
  expect(seen).toMatchObject({ requests: 0, aborted: ['t1'] })
  expect(seen.asked).toHaveLength(1)
  expect(seen.notified).toEqual(['A request in this session waits for your answer.'])
})

test('a -p run and a subagent are never asked', async ($, on) => {
  const seen = engine(on, { cold: COLD, choices: ['Stop'], surfaces: [] })
  await step($)
  await step($, { ...STEP, agentId: 'a1' })
  expect(seen).toMatchObject({ asked: [], requests: 2 })
})

test('a failed check holds the request rather than sending it', async ($, on) => {
  const seen = engine(on, { cold: COLD, meterFails: true })
  expect((await step($)).answer).toBe('')
  expect(seen).toMatchObject({ requests: 0, aborted: ['t1'] })
})

test('turned off, nothing is checked', { options: { cold_cache_check: false } }, async ($, on) => {
  const seen = engine(on, { cold: COLD, choices: ['Stop'] })
  await step($)
  expect(seen).toMatchObject({ asked: [], meterArgs: [], requests: 1 })
})

test('/handoff copies without a question and puts the session on hold', async ($, on) => {
  const seen = engine(on, { cold: null, choices: ['Continue here'] })
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  const { text } = await $.command.run({ command: 'handoff', args: '' })
  expect(seen.copied[0]).toContain(`Its transcript: ${PATH}`)
  expect(text).toMatch(/^Copied for a new session/)
  expect(seen.meterArgs).toEqual([['path', 's1']])
  // Back here, the next request asks first.
  expect((await step($)).answer).toBe('sent')
  expect(seen.asked).toHaveLength(1)
})

test('with no steps set the handoff is the pointer alone', () => {
  const text = handoffText('uk', '', { sessionId: 's1', transcriptPath: PATH })
  expect(text.split('\n\n')).toHaveLength(2)
  expect(text).toContain('сесії Claude Code s1')
  expect(text).toContain(`транскрипт: ${PATH}`)
})
