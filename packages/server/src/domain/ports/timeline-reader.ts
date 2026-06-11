import type { TimelineEvent } from '@/domain/entities'

// TimelineReader (starship P5 living tick) — the READ seam for sim-provenance
// timeline events. The during-play living tick needs two facts the existing
// dossier read does not expose: the latest provenance='sim' beats (to seed beat
// memory + surface off-screen drama into narrator context) and the highest
// sim_tick so far (so the tick continues numbering past the pre-play sim).
// Dumb CRUD read — no deciding logic. Async by mandate (spec §5.3).
export interface TimelineReader {
  /** The latest provenance='sim' events for a world, newest first, capped at `limit`. */
  recentSimEvents(worldId: number, limit: number): Promise<TimelineEvent[]>
  /** The highest sim_tick across a world's sim events, or null when none exist. */
  maxSimTick(worldId: number): Promise<number | null>
}
