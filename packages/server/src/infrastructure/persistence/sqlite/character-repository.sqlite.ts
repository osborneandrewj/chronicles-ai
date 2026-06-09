import 'server-only'

import {
  getCharactersForWorld,
  getCharactersInPlace,
  insertBoundedCharacter,
  setCharacterPlace,
} from '@/lib/db'
import { recordAppearancesAndAutoPromote } from '@/lib/npc-promotion'
import type { Character } from '@/lib/world-state'
import type {
  AppearancePromotionResult,
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

  setPlace(characterId: number, placeId: number | null): Promise<void> {
    setCharacterPlace(characterId, placeId)
    return Promise.resolve()
  }

  // Delegates to the byte-identical `lib/npc-promotion` transaction; the
  // promotion decision stays in the pure `domain/services/npc-promotion` it uses.
  recordAppearancesAndAutoPromote(
    worldId: number,
    presentCharacters: Character[],
    turnId: number,
  ): Promise<AppearancePromotionResult> {
    return Promise.resolve(
      recordAppearancesAndAutoPromote(worldId, presentCharacters, turnId),
    )
  }
}
