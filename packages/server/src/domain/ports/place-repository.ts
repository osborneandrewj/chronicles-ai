import type { Place } from '@/lib/world-state'

// PlaceRepository (spec §3.4) — dumb CRUD reads over the `places` aggregate.
// Async by mandate (spec §5.3).
export interface PlaceRepository {
  forWorld(worldId: number): Promise<Place[]>
  byId(id: number): Promise<Place | null>
}
