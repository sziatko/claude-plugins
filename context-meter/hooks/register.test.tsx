import { expect, test } from 'claude-code/testing'

const CONTEXT_SIZE = 1_000_000

const BAND = {
  plugin: 'context-meter',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const dialog = () =>
  ({
    plugin: 'context-meter',
    component: 'AskUserQuestion',
    requestId: 'toolu_1',
    props: { tool: 'AskUserQuestion', questions: [] as unknown[] },
  }) as const

type Figures = { tokens?: number; env?: string; usd?: number }

// Stands for the engine beneath the mod: its drawings, the usage and the variable.
function engine(on: any, { tokens, env, usd }: Figures) {
  on('ui.render', ($: any, e: any) => {
    if (e.component === 'AskUserQuestion') return { type: 'engine', ref: 0 }
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('session.usage', () => ({
    value: {
      context: { tokens, window: CONTEXT_SIZE },
      cost: usd === undefined ? undefined : { usd },
    },
  }))
  on('env.get', () => ({ value: env }))
}

async function band($: any, surface: 'vscode' | 'desktop' | 'terminal' = 'vscode') {
  const ui = await $.ui.mount({ ...BAND, surface })
  const text = (await ui.find({ type: 'Text' }))?.text
  const color = (await ui.find({ type: 'Text', text: /^[▰▱]+$/ }))?.props.color
  await ui.unmount()
  return { text, color }
}

test('the band measures the fill against the auto-compact window', async ($, on) => {
  engine(on, { tokens: 24_000, env: '300000' })
  expect((await band($)).text).toBe('▰▱▱▱▱▱▱▱▱▱ 8% · 24k / 300k')
})

test('with the variable unset the whole window is the limit', async ($, on) => {
  engine(on, { tokens: 100_000 })
  expect((await band($)).text).toBe('▰▱▱▱▱▱▱▱▱▱ 10% · 100k / 1000k')
})

test('a variable past the window does not raise the limit', async ($, on) => {
  engine(on, { tokens: 100_000, env: '5000000' })
  expect((await band($)).text).toBe('▰▱▱▱▱▱▱▱▱▱ 10% · 100k / 1000k')
})

test('scaled to the window, the variable is not read', { options: { bar_scale: 'window' } }, async ($, on) => {
  engine(on, { tokens: 240_000, env: '300000' })
  expect((await band($)).text).toBe('▰▰▱▱▱▱▱▱▱▱ 24% · 240k / 1000k')
})

test('past the limit the bar stays full and the figure tells', async ($, on) => {
  engine(on, { tokens: 330_000, env: '300000' })
  expect((await band($)).text).toBe('▰▰▰▰▰▰▰▰▰▰ 110% · 330k / 300k')
})

// `warning` is grey in the VS Code panel; the bar must name a color it paints.
for (const [tokens, color] of [
  [69_000, 'success'],
  [70_000, 'yellow'],
  [89_000, 'yellow'],
  [90_000, 'error'],
] as const) {
  test(`at ${tokens / 1000}% the bar is ${color}`, async ($, on) => {
    engine(on, { tokens, env: '100000' })
    expect((await band($)).color).toBe(color)
  })
}

test('the thresholds are settings', { options: { warn_percent: 50, alert_percent: 60 } }, async ($, on) => {
  engine(on, { tokens: 55_000, env: '100000' })
  expect((await band($)).color).toBe('yellow')
})

test('the cost closes the line, in dollars and cents', async ($, on) => {
  engine(on, { tokens: 24_000, env: '300000', usd: 1.5 })
  expect((await band($)).text).toBe('▰▱▱▱▱▱▱▱▱▱ 8% · 24k / 300k · $1.50')
})

test('the cost can be left out', { options: { show_cost: false } }, async ($, on) => {
  engine(on, { tokens: 24_000, env: '300000', usd: 1.5 })
  expect((await band($)).text).toBe('▰▱▱▱▱▱▱▱▱▱ 8% · 24k / 300k')
})

test('no figure yet leaves the band to the engine', async ($, on) => {
  engine(on, { env: '300000' })
  expect((await band($)).text).toBe('engine')
})

test('the desktop app draws the band too', async ($, on) => {
  engine(on, { tokens: 24_000, env: '300000' })
  expect((await band($, 'desktop')).text).toBe('▰▱▱▱▱▱▱▱▱▱ 8% · 24k / 300k')
})

test('a terminal band is left to the engine by default', async ($, on) => {
  engine(on, { tokens: 24_000, env: '300000' })
  expect((await band($, 'terminal')).text).toBe('engine')
})

test('a terminal band is drawn when asked for', { options: { show_in_terminal: true } }, async ($, on) => {
  engine(on, { tokens: 24_000, env: '300000' })
  expect((await band($, 'terminal')).text).toBe('▰▱▱▱▱▱▱▱▱▱ 8% · 24k / 300k')
})

test('a measurement redraws', async ($, on) => {
  const invalidated: string[] = []
  on('ui.invalidate', (_: unknown, e: { event: string }) => {
    invalidated.push(e.event)
    return { value: undefined }
  })
  on('session.measure', (_: unknown, e: any) => ({ changed: e.changed }))

  await $.session.measure({
    context: { tokens: 24_000, window: CONTEXT_SIZE },
    rateLimits: [],
    changed: ['context'],
  })

  expect(invalidated).toEqual(['ui.render'])
})

test('in VS Code the dialog carries the line above its form', async ($, on) => {
  engine(on, { tokens: 24_000, env: '300000', usd: 1.5 })
  const ui = await $.ui.mount({ ...dialog(), surface: 'vscode' })

  expect((await ui.find({ type: 'Text', text: /▰/ }))?.text).toBe('▰▱▱▱▱▱▱▱▱▱ 8% · 24k / 300k · $1.50')
  await ui.unmount()
})

test('with no figure yet the dialog is the form alone', async ($, on) => {
  engine(on, { env: '300000' })
  const ui = await $.ui.mount({ ...dialog(), surface: 'vscode' })

  expect(await ui.find({ type: 'Text', text: /▰/ })).toBeUndefined()
  await ui.unmount()
})

test('a terminal dialog is left alone', async ($, on) => {
  engine(on, { tokens: 24_000, env: '300000' })
  const ui = await $.ui.mount({ ...dialog(), surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /▰/ })).toBeUndefined()
  await ui.unmount()
})
