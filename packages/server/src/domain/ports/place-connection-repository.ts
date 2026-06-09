import type { PlaceConnection } from '@/domain/entities'

// A topology edge to insert. Ids are assigned by the store; `created_at` is
// stamped by the adapter (clock), so the write side takes only the domain shape.
export type PlaceConnectionInput = {
  world_id: number
  from_place_id: number
  to_place_id: number
  kind: string | null
  bidirectional: number
}

// PlaceConnectionRepository (starship P0) — dumb CRUD over `place_connections`,
// the bounded-world room-connectivity graph. Building a DeckGraph / connectivity
// validation is deciding logic that stays in the `deck-graph` domain service;
// this port is the persistence seam only. Async by mandate (spec §5.3).
export interface PlaceConnectionRepository {
  forWorld(worldId: number): Promise<PlaceConnection[]>
  add(edges: PlaceConnectionInput[]): Promise<void>
}
