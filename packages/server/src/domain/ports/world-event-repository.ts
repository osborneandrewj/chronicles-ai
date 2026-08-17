import type { WorldEvent, WorldEventInput } from '@/domain/entities'

export const WORLD_EVENT_RECENT_CAP = 20

// Dumb CRUD for the append-only world_events log. Deciding which event to
// emit stays in domain services / the turn pipeline.
export interface WorldEventRepository {
  append(event: WorldEventInput): Promise<void>
  /** Newest first. Caps at `limit` (default WORLD_EVENT_RECENT_CAP). */
  recentForWorld(worldId: number, limit?: number): Promise<WorldEvent[]>
}