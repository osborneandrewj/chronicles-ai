import type { ReverieInput, ReverieRow } from '@/lib/reveries'

// ReverieRepository (spec §3.4) — dumb CRUD over append-only NPC `reveries`.
// Reverie flaring / mint-state / dedup is deciding logic that stays in the
// `reveries.ts` domain service (P4); this port is the persistence seam only.
// Async by mandate (spec §5.3).
export interface ReverieRepository {
  forCharacter(characterId: number): Promise<ReverieRow[]>
  forCharacters(characterIds: number[]): Promise<Map<number, ReverieRow[]>>
  forWorld(worldId: number): Promise<ReverieRow[]>
  add(
    worldId: number,
    characterId: number,
    inputs: ReverieInput[],
    createdTurnId: number | null,
  ): Promise<void>
  stampFlared(reverieIds: number[], turnId: number): Promise<void>
  repoint(sourceCharacterId: number, targetCharacterId: number): Promise<void>
}
