import 'server-only'

import type { Character } from '@/lib/world-state'
import type {
  CharacterInput,
  CharacterRepository,
} from '@/domain/ports/character-repository'

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

  // Bounded-world crew insert (starship P1). `role` stores into the existing
  // currentFocus field (no dedicated role column, mirroring SQLite). daily_loop
  // arrives as JSON text and is stored as a native subdoc (the mapper reverses it).
  async add(character: CharacterInput): Promise<{ id: number }> {
    const id = await this.ctx.nextSeq('characterId')
    const now = new Date()
    let dailyLoop: Record<string, unknown> | null = null
    try {
      dailyLoop = character.daily_loop
        ? (JSON.parse(character.daily_loop) as Record<string, unknown>)
        : null
    } catch {
      dailyLoop = null
    }
    await this.ctx.models.Character.create(
      [
        {
          id,
          worldId: character.world_id,
          name: character.name,
          nameKey: character.name.toLowerCase(),
          description: character.description,
          isPlayer: character.is_player === 1,
          currentPlaceId: character.current_place_id,
          currentFocus: character.role,
          activeGoal: character.active_goal,
          dailyLoop,
          createdAt: now,
          updatedAt: now,
        },
      ],
      { session: this.ctx.currentSession ?? undefined },
    )
    return { id }
  }

  // Bounded-world sim write (starship P2): move a character to a room (or clear
  // it). Mirrors the SQLite UPDATE; stamps updatedAt like the sibling writes.
  async setPlace(characterId: number, placeId: number | null): Promise<void> {
    await this.ctx.models.Character.updateOne(
      { id: characterId },
      { $set: { currentPlaceId: placeId, updatedAt: new Date() } },
      { session: this.ctx.currentSession ?? undefined },
    )
  }
}
