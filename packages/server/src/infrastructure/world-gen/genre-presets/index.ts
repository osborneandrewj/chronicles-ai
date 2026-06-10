import 'server-only'

// Genre-preset registry: public API.
// listGenrePresets() returns ONLY id + label — hiddenPremise is never sent to the player.
// getGenrePreset() returns the full preset for internal use (narrator/archivist seeding).

import { PRESET_LIST } from './presets'
import type { GenrePreset } from './types'

export type { GenrePreset } from './types'

/** Stable map keyed by preset id. */
export const GENRE_PRESETS: ReadonlyMap<string, GenrePreset> = new Map(
  PRESET_LIST.map((p) => [p.id, p]),
)

/** Player-facing list: id + label ONLY. hiddenPremise is intentionally omitted. */
export function listGenrePresets(): { id: string; label: string }[] {
  return PRESET_LIST.map(({ id, label }) => ({ id, label }))
}

/** Full preset for internal use. Returns undefined for unknown ids. */
export function getGenrePreset(id: string): GenrePreset | undefined {
  return GENRE_PRESETS.get(id)
}
