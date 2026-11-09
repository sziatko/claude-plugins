import type { PluginOptions } from 'claude-code'

// The plugin's userConfig, parsed once into what each feature needs; a feature that is
// off is null, so no code path reads a setting of a feature that does not run.
export type Settings = {
  language: 'en' | 'uk'
  band: {
    scale: 'auto-compact' | 'window'
    warnPercent: number
    alertPercent: number
    showCost: boolean
    showInTerminal: boolean
  }
  coldCache: { minTokens: number; handoffSteps: string } | null
  compactGuard: { maxPercent: number } | null
  afterCompactNote: string | null
}

function field<T extends 'number' | 'boolean' | 'string'>(o: PluginOptions, key: string, type: T) {
  const value = o[key]
  if (typeof value !== type) throw new Error(`context-meter: option ${key} is ${typeof value}, expected ${type}`)
  return value as T extends 'number' ? number : T extends 'boolean' ? boolean : string
}

function oneOf<const T extends string>(o: PluginOptions, key: string, values: readonly T[]) {
  const value = field(o, key, 'string')
  if (!values.includes(value as T)) throw new Error(`context-meter: option ${key} is "${value}", expected ${values.join(' or ')}`)
  return value as T
}

export function parseSettings(o: PluginOptions): Settings {
  return {
    language: oneOf(o, 'language', ['en', 'uk']),
    band: {
      scale: oneOf(o, 'bar_scale', ['auto-compact', 'window']),
      warnPercent: field(o, 'warn_percent', 'number'),
      alertPercent: field(o, 'alert_percent', 'number'),
      showCost: field(o, 'show_cost', 'boolean'),
      showInTerminal: field(o, 'show_in_terminal', 'boolean'),
    },
    coldCache: field(o, 'cold_cache_check', 'boolean')
      ? {
          minTokens: field(o, 'cold_cache_min_tokens', 'number'),
          handoffSteps: field(o, 'handoff_steps', 'string').trim(),
        }
      : null,
    compactGuard: field(o, 'compact_guard', 'boolean')
      ? { maxPercent: field(o, 'compact_guard_max_percent', 'number') }
      : null,
    // Empty turns the note off.
    afterCompactNote: field(o, 'after_compact_note', 'string').trim() || null,
  }
}
