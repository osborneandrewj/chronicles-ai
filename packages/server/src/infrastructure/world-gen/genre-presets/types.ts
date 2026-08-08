import 'server-only'

import type { MetaFrameKind } from '@/domain/entities'

// Genre preset type for historical-adventure world creation.
// The hiddenPremise is a rich internal seed NEVER shown to the player —
// only id + label are surfaced to the picker UI.

export type GenrePreset = {
  /** Kebab-case stable identifier, e.g. 'ancient-rome'. */
  id: string
  /** Player-facing display label, e.g. 'Ancient Rome'. */
  label: string
  /** Rich internal premise (3-6 sentences). NEVER shown to the player. */
  hiddenPremise: string
  /** Culture/era tags for name-pool keying, e.g. ['roman']. */
  eraTags: string[]
  /** Mood/genre tone tags, e.g. ['political', 'martial', 'intrigue']. */
  toneTags: string[]
  /**
   * Narrative meta-frame for this preset's adventure. Omit (the default) for a
   * plain grounded standalone world — no concealed hub, Meta-Story Bible,
   * session, lucidity, or REALITY cue. Set 'simulation' to OPT IN to the
   * concealed-simulation machinery (genre-coupling audit, Phase 1). Every
   * shipped historical preset is grounded.
   */
  metaFrameKind?: MetaFrameKind
}
