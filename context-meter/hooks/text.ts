// Everything the plugin says, in the languages the `language` option offers.

export const k = (n: number) => `${Math.round(n / 1000)}k`

// What meter.js reports about a cold cache.
export type Cold = { idleMin: number; ttlMin: number; tokens: number; writePrice: number }

export type Handoff = {
  sessionId: string
  transcriptPath: string
  summary: string | null
  prompt: string | undefined
  answer: string | undefined
  files: string[]
  agents: string[]
}

type Text = {
  coldQuestion: (c: Cold) => string
  continue: string
  handoff: string
  stop: string
  copied: (chars: number) => string
  handoffLines: (h: Handoff) => (string | false | null | undefined)[]
  compactSkipped: (files: number, tokens: number) => string
}

export const TEXT: Record<'en' | 'uk', Text> = {
  en: {
    coldQuestion: c =>
      `The cache is cold: idle ${c.idleMin} min, the cache lives ${c.ttlMin} min, context ${k(c.tokens)}. ` +
      `This request writes the whole context to the cache again at ×${c.writePrice} the input price ` +
      'instead of ×0.1 for a read. What now?',
    continue: 'Continue here',
    handoff: 'Copy for a new session',
    stop: 'Stop',
    copied: chars => `Copied for a new session, ${chars} characters.`,
    handoffLines: h => [
      `Continuing the work of the previous session ${h.sessionId}.`,
      `Transcript: ${h.transcriptPath}. It is large: do not read it whole. Grep it for a keyword ` +
        'or read its tail; if you need a lot of it, hand that to a subagent.',
      h.summary && `The last compaction summary:\n${h.summary}`,
      h.prompt && `My last request:\n${h.prompt}`,
      h.answer && `Your last message:\n${h.answer}`,
      h.files.length > 0 && `Files changed in the session:\n${h.files.join('\n')}`,
      h.agents.length > 0 && `Subagents running: ${h.agents.join('; ')}`,
    ],
    compactSkipped: (files, tokens) =>
      `Auto-compact skipped: work in progress (${files} uncommitted files), context ${k(tokens)}.`,
  },
  uk: {
    coldQuestion: c =>
      `Кеш холодний: простій ${c.idleMin} хв, кеш живе ${c.ttlMin} хв, контекст ${k(c.tokens)}. ` +
      `Запит запише весь контекст у кеш заново: ×${String(c.writePrice).replace('.', ',')} ` +
      'від ціни вводу замість ×0,1 за читання. Що робити?',
    continue: 'Продовжити тут',
    handoff: 'Скопіювати для нової сесії',
    stop: 'Зупинитися',
    copied: chars => `Скопійовано для нової сесії, ${chars} символів.`,
    handoffLines: h => [
      `Продовжую роботу з попередньої сесії ${h.sessionId}.`,
      `Транскрипт: ${h.transcriptPath}. Він великий: не читай цілком. Шукай Grep за ключовим ` +
        'словом або читай хвіст; якщо треба багато, віддай підагенту.',
      h.summary && `Останнє зведення компакту:\n${h.summary}`,
      h.prompt && `Мій останній запит:\n${h.prompt}`,
      h.answer && `Твоє останнє повідомлення:\n${h.answer}`,
      h.files.length > 0 && `Файли, змінені за сесію:\n${h.files.join('\n')}`,
      h.agents.length > 0 && `Запущені підагенти: ${h.agents.join('; ')}`,
    ],
    compactSkipped: (files, tokens) =>
      `Автокомпакт пропущено: крок триває (незакомічених файлів: ${files}), контекст ${k(tokens)}.`,
  },
}
