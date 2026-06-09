import 'server-only'

import type { CharacterRelationship } from '@/domain/entities'
import type {
  RelationshipInput,
  RelationshipRepository,
} from '@/domain/ports/relationship-repository'

import type { MongoContext } from '../mongo-context'
import { mapCharacterRelationship } from './mappers'

// Mongo RelationshipRepository (starship P1). Dumb CRUD over the
// `character_relationships` graph. `upsert` replaces kind/note + sets valence on
// an existing (from,to) edge, otherwise inserts; `adjustValence` applies a signed
// delta. `updatedAt` is stamped here (the SQLite analog of datetime('now')).
// Tension scoring / valence-drift math stays in the relationship-drift /
// beat-gating domain services.
export class MongoRelationshipRepository implements RelationshipRepository {
  constructor(private readonly ctx: MongoContext) {}

  private get session() {
    return this.ctx.currentSession ?? undefined
  }

  async forWorld(worldId: number): Promise<CharacterRelationship[]> {
    const docs = await this.ctx.models.CharacterRelationship.find({ worldId })
      .sort({ id: 1 })
      .lean()
    return docs.map(mapCharacterRelationship)
  }

  async upsert(edges: RelationshipInput[]): Promise<void> {
    for (const edge of edges) {
      const existing = await this.ctx.models.CharacterRelationship.findOne({
        worldId: edge.world_id,
        fromCharacterId: edge.from_character_id,
        toCharacterId: edge.to_character_id,
      }).lean()
      if (existing) {
        await this.ctx.models.CharacterRelationship.updateOne(
          { id: existing.id },
          {
            $set: {
              kind: edge.kind,
              valence: edge.valence,
              note: edge.note,
              updatedAt: new Date(),
            },
          },
          { session: this.session },
        )
      } else {
        const id = await this.ctx.nextSeq('relationshipId')
        await this.ctx.models.CharacterRelationship.create(
          [
            {
              id,
              worldId: edge.world_id,
              fromCharacterId: edge.from_character_id,
              toCharacterId: edge.to_character_id,
              kind: edge.kind,
              valence: edge.valence,
              note: edge.note,
              updatedAt: new Date(),
            },
          ],
          { session: this.session },
        )
      }
    }
  }

  async adjustValence(relationshipId: number, valence: number): Promise<void> {
    await this.ctx.models.CharacterRelationship.updateOne(
      { id: relationshipId },
      { $inc: { valence }, $set: { updatedAt: new Date() } },
      { session: this.session },
    )
  }
}
