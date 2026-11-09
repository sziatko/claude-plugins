// Everything the plugin says, in the languages the `language` option offers.

export const k = (n: number) => `${Math.round(n / 1000)}k`

// What meter.js reports about a cold cache.
export type Cold = { idleMin: number; ttlMin: number; tokens: number; writePrice: number }

// A pointer to the old session, not a copy of it: the new one reads what it needs.
export type Handoff = { sessionId: string; transcriptPath: string }

type Text = {
  coldQuestion: (c: Cold) => string
  header: string
  continue: string
  handoff: string
  stop: string
  copied: (chars: number) => string
  handoffLines: (h: Handoff) => string[]
  compactSkipped: (files: number, tokens: number) => string
}

export const TEXT: Record<'en' | 'uk', Text> = {
  en: {
    coldQuestion: c =>
      `The cache is cold: idle ${c.idleMin} min, the cache lives ${c.ttlMin} min, context ${k(c.tokens)}. ` +
      `This request writes the whole context to the cache again at ×${c.writePrice} the input price ` +
      'instead of ×0.1 for a read. What now?',
    header: 'Cold cache',
    continue: 'Continue here',
    handoff: 'Copy for a new session',
    stop: 'Stop',
    copied: chars => `Copied for a new session, ${chars} characters.`,
    handoffLines: h => [
      `I am continuing the work of the previous Claude Code session ${h.sessionId}; I left it ` +
        'because its prompt cache had gone cold.',
      `Its transcript: ${h.transcriptPath} (JSONL, one event per line, too big to read whole). ` +
        'Read only its end, about the last 30 lines, to find my last request and where the work ' +
        'stopped. Go further back only for what is still unclear, with Grep rather than reading.',
    ],
    compactSkipped: (files, tokens) =>
      `Auto-compact skipped: work in progress (${files} uncommitted files), context ${k(tokens)}.`,
  },
  uk: {
    coldQuestion: c =>
      `Кеш холодний: простій ${c.idleMin} хв, кеш живе ${c.ttlMin} хв, контекст ${k(c.tokens)}. ` +
      `Запит запише весь контекст у кеш заново: ×${String(c.writePrice).replace('.', ',')} ` +
      'від ціни вводу замість ×0,1 за читання. Що робити?',
    header: 'Холодний кеш',
    continue: 'Продовжити тут',
    handoff: 'Скопіювати для нової сесії',
    stop: 'Зупинитися',
    copied: chars => `Скопійовано для нової сесії, ${chars} символів.`,
    handoffLines: h => [
      `Продовжую роботу попередньої сесії Claude Code ${h.sessionId}: її зупинено, бо кеш ` +
        'промптів охолов.',
      `Її транскрипт: ${h.transcriptPath} (JSONL, подія на рядок, завеликий, щоб читати цілком). ` +
        'Прочитай лише кінець, приблизно останні 30 рядків, щоб знайти мій останній запит і де ' +
        'зупинилася робота. Далі назад іди тільки по те, що ще неясно, і шукай Grep, а не читай.',
    ],
    compactSkipped: (files, tokens) =>
      `Автокомпакт пропущено: крок триває (незакомічених файлів: ${files}), контекст ${k(tokens)}.`,
  },
}
