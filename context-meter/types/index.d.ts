declare module 'claude-code' {
  interface PluginState {
    'context-meter': {
      // When the main loop last sent a model request, in ms since the epoch.
      lastRequestAt: number | null
    }
  }
}
