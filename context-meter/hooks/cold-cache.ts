import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'
import type { Settings } from './settings'
import { TEXT } from './text'
import type { Cold, Handoff } from './text'

// The shortest cache TTL: a request this soon after the last one finds the cache warm.
const MIN_TTL_MS = 5 * 60 * 1000

const transcriptPath = atom({ plugin: 'context-meter', key: 'transcriptPath' } as const, null)
const lastRequestAt = atom({ plugin: 'context-meter', key: 'lastRequestAt' } as const, null)

type Lang = Settings['language']
type ColdSettings = NonNullable<Settings['coldCache']>

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

// True when the person chose not to send the request.
async function isHeld($: EngineInterface, lang: Lang, s: ColdSettings) {
  const path = await read($, transcriptPath)
  const last = await read($, lastRequestAt)
  // A -p run has nobody to ask.
  if (!path || (await $.session.surfaces()).length === 0) return false
  if (last !== null && Date.now() - last < MIN_TTL_MS) return false
  const out = await meter($, ['cold', path, String(s.minTokens)])
  if (!out) return false

  const t = TEXT[lang]
  // Dismissed, or a text typed under Other: nothing is spent, as with Stop.
  const choice = await $.ui.ask(t.coldQuestion(JSON.parse(out) as Cold), [t.continue, t.handoff, t.stop]).catch(() => t.stop)
  if (choice === t.continue) return false
  if (choice === t.handoff) {
    const text = handoffText(lang, s.handoffSteps, { sessionId: await $.session.id(), transcriptPath: path })
    const copied = await $.ui.copy({ text })
    // Shown, never sent to the model: the transcript is where the person copies it from.
    $.ui.log(copied.isCopied ? t.copied(text.length) : text)
  }
  return true
}

async function remember($: EngineInterface, path: string) {
  await update($, transcriptPath, () => path)
}

// Asks before a main-loop model request re-sends a big context to a cold cache. Every
// request passes here, a prompt's, a tool result's, a question's answer or a task
// notification's; Stop leaves what came in the conversation and sends nothing.
export function coldCache(on: On, lang: Lang, s: ColdSettings) {
  on('classic.SessionStart', async ($, e, next) => {
    await remember($, e.transcript_path)
    return next(e)
  })

  // Again on a prompt: a plugin worker the engine replaced starts with no state.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await remember($, e.transcript_path)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    // A subagent has a cache of its own.
    if (e.agentId !== undefined) return yield* next(e)
    if (await isHeld($, lang, s)) {
      await $.turn.abort({ turnId: e.turnId })
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
    }
    await update($, lastRequestAt, () => Date.now())
    return yield* next(e)
  })
}
