declare module 'claude-code' {
  interface PluginState {
    'context-meter': {
      // The transcript the cold-cache question reads; null until a settings hook names it.
      transcriptPath: string | null
      // When the main loop last sent a model request, in ms since the epoch.
      lastRequestAt: number | null
    }
  }
}
