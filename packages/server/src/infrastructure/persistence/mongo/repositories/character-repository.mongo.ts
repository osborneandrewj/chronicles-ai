import 'server-only'

import type { Character } from '@/lib/world-state'
import type { CharacterRepository } from '@/domain/ports/character-repository'

import type { MongoContext } from '../mongo-context'
import { mapCharacter } from './mappers'

// Mongo CharacterRepository (spec §4.2) — dumb CRUD reads over `characters`.
// Name resolution / alias merge / promotion are deciding logic that stays out
// of the adapter (P4/P5).
export class MongoCharacterRepository implements CharacterRepository {
  constructor(private readonly ctx: MongoContext) {}

  async forWorld(worldId: number): Promise<Character[]> {
    const docs = await this.ctx.models.Character.find({ worldId })
      .sort({ id: 1 })
      .lean()
    return docs.map(mapCharacter)
  }

  async inPlace(worldId: number, placeId: number): Promise<Character[]> {
    const docs = await this.ctx.models.Character.find({
      worldId,
      currentPlaceId: placeId,
    })
      .sort({ id: 1 })
      .lean()
    return docs.map(mapCharacter)
  }
}
