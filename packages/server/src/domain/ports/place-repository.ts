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

// The archivist's bare place insert (no deck/layout_hint — those are
// bounded-world only). Mirrors insertPlaceStmt; returns the assigned id.
export type ArchivistPlaceInsert = {
  world_id: number
  name: string
  description: string | null
  kind: string | null
}

// A COALESCE update (omitted column = unchanged). Mirrors updatePlaceStmt.
export type PlaceUpdate = {
  id: number
  description: string | null
  kind: string | null
}

// A plain-assignment merge (the JS layer pre-computes the winning value).
// Mirrors mergePlaceStmt.
export type PlaceMerge = {
  id: number
  description: string | null
  kind: string | null
}

// PlaceRepository (spec §3.4) — dumb CRUD over the `places` aggregate. Reads plus
// `add`, the bounded-world room insert, and the archivist write surface (P4).
// Async by mandate (spec §5.3).
export interface PlaceRepository {
  forWorld(worldId: number): Promise<Place[]>
  byId(id: number): Promise<Place | null>
  add(place: PlaceInput): Promise<{ id: number }>
  currentPlaceForWorld(worldId: number): Promise<Place | null>
  nameById(id: number): Promise<string | null>
  insert(place: ArchivistPlaceInsert): Promise<{ id: number }>
  update(patch: PlaceUpdate): Promise<void>
  merge(patch: PlaceMerge): Promise<void>
  moveCharactersToPlace(toId: number, fromId: number): Promise<void>
  moveScenesToPlace(toId: number, fromId: number): Promise<void>
  delete(id: number): Promise<void>
  appendPlayerNotes(id: number, note: string): Promise<void>
}
