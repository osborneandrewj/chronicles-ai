import 'server-only'

import { getCharactersForWorld, getCharactersInPlace } from '@/lib/db'
import type { Character } from '@/lib/world-state'
import type { CharacterRepository } from '@/domain/ports/character-repository'

// SQLite adapter for CharacterRepository (spec §5.1-P1). Dumb CRUD reads.
export class SqliteCharacterRepository implements CharacterRepository {
  forWorld(worldId: number): Promise<Character[]> {
    return Promise.resolve(getCharactersForWorld(worldId))
  }

  inPlace(worldId: number, placeId: number): Promise<Character[]> {
    return Promise.resolve(getCharactersInPlace(worldId, placeId))
  }
}
