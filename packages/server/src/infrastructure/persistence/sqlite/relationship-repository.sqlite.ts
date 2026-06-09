import 'server-only'

import {
  adjustRelationshipValence,
  getRelationshipsForWorld,
  upsertRelationship,
} from '@/lib/db'
import type { CharacterRelationship } from '@/domain/entities'
import type {
  RelationshipInput,
  RelationshipRepository,
} from '@/domain/ports/relationship-repository'

// SQLite adapter for RelationshipRepository (starship P1). Dumb CRUD over the
// `character_relationships` graph. `updated_at` is stamped with datetime('now')
// in the upsert / adjust statements, consistent with the sibling write adapters.
// Tension scoring / valence-drift math stays in the relationship-drift /
// beat-gating domain services.
export class SqliteRelationshipRepository implements RelationshipRepository {
  forWorld(worldId: number): Promise<CharacterRelationship[]> {
    return Promise.resolve(getRelationshipsForWorld(worldId))
  }

  upsert(edges: RelationshipInput[]): Promise<void> {
    for (const edge of edges) upsertRelationship(edge)
    return Promise.resolve()
  }

  adjustValence(relationshipId: number, valence: number): Promise<void> {
    adjustRelationshipValence(relationshipId, valence)
    return Promise.resolve()
  }
}
