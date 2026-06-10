import 'server-only'

import type { TimelineEvent } from '@/domain/entities'
import type { TimelineReader } from '@/domain/ports/timeline-reader'
import { maxSimTick, recentSimEvents } from '@/lib/db'

// SQLite adapter for TimelineReader (starship P5). Dumb CRUD read over
// `timeline_events`, delegating to the lib/db statements that mirror the dossier
// timeline reads. No deciding logic — the living-tick use case owns what the rows
// mean (beat memory, cooldown seeding, next sim_tick).
export class SqliteTimelineReader implements TimelineReader {
  recentSimEvents(worldId: number, limit: number): Promise<TimelineEvent[]> {
    return Promise.resolve(recentSimEvents(worldId, limit))
  }

  maxSimTick(worldId: number): Promise<number | null> {
    return Promise.resolve(maxSimTick(worldId))
  }
}
