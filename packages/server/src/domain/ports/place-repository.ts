import type { Place } from '@/lib/world-state'

// A place to insert (starship P1). The bounded-world seeder writes rooms with a
// deck + layout_hint (v26) for future map layering. Ids are assigned by the store.
export type PlaceInput = {
  world_id: number
  name: string
  description: string | null
  kind: string | null
  deck: string | null
  layout_hint: string | null
}

// PlaceRepository (spec §3.4) — dumb CRUD over the `places` aggregate. Reads plus
// `add`, the bounded-world room insert. Async by mandate (spec §5.3).
export interface PlaceRepository {
  forWorld(worldId: number): Promise<Place[]>
  byId(id: number): Promise<Place | null>
  add(place: PlaceInput): Promise<{ id: number }>
}
