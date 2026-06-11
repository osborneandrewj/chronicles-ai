import type { CharacterRelationship } from '@/domain/entities'

// A relationship edge to insert / upsert. Ids + `updated_at` are owned by the
// adapter; `valence` defaults to 0 at the schema level when omitted upstream.
export type RelationshipInput = {
  world_id: number
  from_character_id: number
  to_character_id: number
  kind: string | null
  valence: number
  note: string | null
}

// RelationshipRepository (starship P0) — dumb CRUD over `character_relationships`,
// the relationship graph. Tension scoring / valence-drift math is deciding logic
// that stays in the `relationship-drift` / `beat-gating` domain services; this
// port is the persistence seam only. `upsert` writes a (from,to) edge, replacing
// kind/note and setting valence; `adjustValence` applies a signed delta to an
// existing edge (clamping is the caller's domain concern). Async by mandate.
export interface RelationshipRepository {
  forWorld(worldId: number): Promise<CharacterRelationship[]>
  upsert(edges: RelationshipInput[]): Promise<void>
  adjustValence(relationshipId: number, valence: number): Promise<void>
}
