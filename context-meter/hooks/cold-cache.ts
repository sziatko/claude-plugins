import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, TurnStepInput, TurnStepResult } from 'claude-code'
import type { Settings } from './settings'
import { TEXT } from './text'
import type { Cold, Handoff } from './text'

// The shortest cache TTL: a request this soon after the last one finds the cache warm.
const MIN_TTL_MS = 5 * 60 * 1000

const lastRequestAt = atom({ plugin: 'context-meter', key: 'lastRequestAt' } as const, null)

type Lang = Settings['language']
type ColdSettings = NonNullable<Settings['coldCache']>

// What the plugin knows of a session, kept in the store so that it outlives a reload and a
// hooks worker the engine replaced. `attached`: a surface has drawn the session, so an empty
// roster means it is hidden, not a -p run. `held`: the person answered anything but Continue
// (or ran /handoff); every request asks again until they do.
type Mark = { attached: boolean; held: boolean }

const markKey = (sessionId: string) => `session:${sessionId}`

async function readMark($: EngineInterface, sessionId: string): Promise<Mark> {
  const value = await $.store.get(markKey(sessionId))
  // A session this plugin has not met yet.
  if (value === undefined) return { attached: false, held: false }
  const m = value as Partial<Mark>
  if (typeof m.attached !== 'boolean' || typeof m.held !== 'boolean') {
    throw new Error(`context-meter: store key ${markKey(sessionId)} holds ${JSON.stringify(value)}`)
  }
  return { attached: m.attached, held: m.held }
}

// ponytail: one small key per session, never pruned; prune by age if the store nears its 4 MiB.
const writeMark = ($: EngineInterface, sessionId: string, mark: Mark) => $.store.set(markKey(sessionId), mark)

// A pointer to the old session plus the steps set, not a copy of the conversation: the new
// session reads only as much of the transcript as it needs.
export const handoffText = (lang: Lang, steps: string, h: Handoff) =>
  [...TEXT[lang].handoffLines(h), steps].filter(Boolean).join('\n\n')

// meter.js reads the transcript: the module reads no file over 4 MiB, and a long session's
// transcript is past that.
async function meter($: EngineInterface, args: string[]) {
  const { exitCode, stdout, stderr } = await $.process.run(['node', `${$.plugin.root}/scripts/meter.js`, ...args])
  if (exitCode !== 0) throw new Error(`meter.js ${args[0]} exited ${exitCode}: ${stderr}`)
  return stdout
}

type Found = { transcriptPath: string; cold: Cold | null }

// Copies the handoff and returns the line to show: the text itself when the clipboard is out
// of reach, so the person copies it from the transcript. Shown, never sent to the model.
async function copyHandoff($: EngineInterface, lang: Lang, s: ColdSettings, sessionId: string, transcriptPath: string) {
  const text = handoffText(lang, s.handoffSteps, { sessionId, transcriptPath })
  const copied = await $.ui.copy({ text })
  return copied.isCopied ? TEXT[lang].copied(text.length) : text
}

// True when the request may go out.
async function mayRequest($: EngineInterface, lang: Lang, s: ColdSettings) {
  const sessionId = await $.session.id()
  const mark = await readMark($, sessionId)
  const isShown = (await $.session.surfaces()).length > 0
  if (isShown && !mark.attached) await writeMark($, sessionId, { ...mark, attached: true })
  // Never drawn: a -p run or the SDK, with nobody to ask.
  if (!isShown && !mark.attached) return true

  const t = TEXT[lang]
  let question = t.heldQuestion
  let transcriptPath: string | null = null
  if (!mark.held) {
    const last = await read($, lastRequestAt)
    if (last !== null && Date.now() - last < MIN_TTL_MS) return true
    const found = JSON.parse(await meter($, ['cold', sessionId, String(s.minTokens)])) as Found
    if (found.cold === null) return true
    question = t.coldQuestion(found.cold)
    transcriptPath = found.transcriptPath
  }

  // Hidden: the question waits in the session until the person opens it.
  if (!isShown) {
    await $.ui.notify(t.waiting).catch((err: unknown) => $.ui.log(`context-meter: notify failed: ${err}`, { to: 'debug' }))
  }
  // Dismissed, a text typed under Other, or nobody could be asked after all: as Stop.
  const choice = await $.ui
    .ask(question, { header: t.header, options: [t.continue, t.handoff, t.stop] })
    .catch(() => t.stop)
  if (choice === t.continue) {
    await writeMark($, sessionId, { attached: true, held: false })
    return true
  }
  if (choice === t.handoff) {
    transcriptPath ??= (await meter($, ['path', sessionId])).trim()
    $.ui.log(await copyHandoff($, lang, s, sessionId, transcriptPath))
  }
  await writeMark($, sessionId, { attached: true, held: true })
  return false
}

// Ends the turn with nothing sent; what came in stays in the conversation.
async function hold($: EngineInterface, e: TurnStepInput): Promise<TurnStepResult> {
  await $.turn.abort({ turnId: e.turnId })
  return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
}

// Asks before a main-loop model request re-sends a big context to a cold cache, and holds
// every request after an answer other than Continue. Every request passes here: a prompt's,
// a tool result's, a question's answer or a task notification's.
export function coldCache(on: On, lang: Lang, s: ColdSettings) {
  const t = TEXT[lang]

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'handoff', description: t.commandDescription })
    return next(e)
  })

  // Copies the handoff with no question, for leaving a session at will; the session is then
  // held like after the question's Copy.
  on('command.run', { command: 'handoff' }, async $ => {
    const sessionId = await $.session.id()
    const transcriptPath = (await meter($, ['path', sessionId])).trim()
    const said = await copyHandoff($, lang, s, sessionId, transcriptPath)
    await writeMark($, sessionId, { attached: true, held: true })
    return { text: said }
  })

  on('turn.step', async function* ($, e, next) {
    // A subagent has a cache of its own.
    if (e.agentId !== undefined) return yield* next(e)
    if (!(await mayRequest($, lang, s))) return await hold($, e)
    await update($, lastRequestAt, () => Date.now())
    return yield* next(e)
  }).catch(async function* ($, e, next) {
    if (next.called) return yield* next(e)
    // A check that failed or overran holds the request: sent, it would write the cold cache.
    $.ui.log(t.checkFailed(next.error.message ?? next.error.kind))
    return await hold($, e)
  })
}
