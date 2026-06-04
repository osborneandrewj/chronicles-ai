import 'server-only'

import {
  addReveriesForCharacter,
  getReveriesForCharacter,
  getReveriesForCharacters,
  getReveriesForWorld,
  repointReveries,
  stampFlaredReveries,
  type ReverieInput,
  type ReverieRow,
} from '@/lib/reveries'
import type { ReverieRepository } from '@/domain/ports/reverie-repository'

// SQLite adapter for ReverieRepository (spec §5.1-P1). Delegates to the
// persistence functions in `reveries.ts`. Flaring / mint-state / dedup remain
// pure domain logic in that module until P4.
export class SqliteReverieRepository implements ReverieRepository {
  forCharacter(characterId: number): Promise<ReverieRow[]> {
    return Promise.resolve(getReveriesForCharacter(characterId))
  }

  forCharacters(characterIds: number[]): Promise<Map<number, ReverieRow[]>> {
    return Promise.resolve(getReveriesForCharacters(characterIds))
  }

  forWorld(worldId: number): Promise<ReverieRow[]> {
    return Promise.resolve(getReveriesForWorld(worldId))
  }

  add(
    worldId: number,
    characterId: number,
    inputs: ReverieInput[],
    createdTurnId: number | null,
  ): Promise<void> {
    addReveriesForCharacter(worldId, characterId, inputs, createdTurnId)
    return Promise.resolve()
  }

  stampFlared(reverieIds: number[], turnId: number): Promise<void> {
    stampFlaredReveries(reverieIds, turnId)
    return Promise.resolve()
  }

  repoint(sourceCharacterId: number, targetCharacterId: number): Promise<void> {
    repointReveries(sourceCharacterId, targetCharacterId)
    return Promise.resolve()
  }
}
