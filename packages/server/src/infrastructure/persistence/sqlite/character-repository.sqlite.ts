import 'server-only'

import {
  getCharactersForWorld,
  getCharactersInPlace,
  insertBoundedCharacter,
} from '@/lib/db'
import type { Character } from '@/lib/world-state'
import type {
  CharacterInput,
  CharacterRepository,
} from '@/domain/ports/character-repository'

// SQLite adapter for CharacterRepository (spec §5.1-P1). Dumb CRUD.
export class SqliteCharacterRepository implements CharacterRepository {
  forWorld(worldId: number): Promise<Character[]> {
    return Promise.resolve(getCharactersForWorld(worldId))
  }

  inPlace(worldId: number, placeId: number): Promise<Character[]> {
    return Promise.resolve(getCharactersInPlace(worldId, placeId))
  }

  add(character: CharacterInput): Promise<{ id: number }> {
    return Promise.resolve(insertBoundedCharacter(character))
  }
}
