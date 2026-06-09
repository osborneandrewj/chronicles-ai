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
  /**
   * Mint-throttle inputs for `canMintReverie` (the pure flare service owns the
   * decision). `hasAny` is whether the NPC holds any reverie; `playerTurnsSinceLast`
   * is the count of this world's player turns inserted after the NPC's most recent
   * minted reverie (Infinity when none carries a created_turn_id, so the cooldown
   * does not block the next mint). Mirrors `reveries.reverieMintState`.
   */
  mintState(
    worldId: number,
    characterId: number,
  ): Promise<{ hasAny: boolean; playerTurnsSinceLast: number }>
}
