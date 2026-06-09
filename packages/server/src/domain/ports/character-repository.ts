import type { Character } from '@/lib/world-state'

// Result of the appearance-bump / auto-promotion pass (spec §3.4-P3). `promoted`
// is the names of NPCs that crossed the auto-promote threshold on this call;
// `tiers` records every other tier transition (for turn metadata / logging).
export type AppearancePromotionResult = {
  promoted: string[]
  counted: number
  tiers: Record<'local' | 'nearby' | 'distant' | 'dormant' | 'demoted', string[]>
}

// A character to insert (starship P1). The bounded-world seeder writes crew with
// a `role` (stored in the existing current_focus field — there is no dedicated
// role column), an active_goal, and a daily_loop (JSON text, characters.daily_loop
// v24). Ids are assigned by the store.
export type CharacterInput = {
  world_id: number
  name: string
  description: string | null
  is_player: number
  current_place_id: number | null
  role: string | null
  active_goal: string | null
  daily_loop: string | null
}

// CharacterRepository (spec §3.4) — dumb CRUD over the `characters` aggregate.
// Reads plus `add` (the bounded-world crew insert) and `setPlace` (the P2 sim
// moving an NPC to a room). Name resolution / alias merge / promotion are
// deciding logic that stays out of the adapter (P4). Async by mandate (spec §5.3).
export interface CharacterRepository {
  forWorld(worldId: number): Promise<Character[]>
  inPlace(worldId: number, placeId: number): Promise<Character[]>
  add(character: CharacterInput): Promise<{ id: number }>
  /** Move a character to a room (or clear its room when null). */
  setPlace(characterId: number, placeId: number | null): Promise<void>
  /**
   * Bump appearance_count for each present NPC and auto-promote/demote agency
   * tiers in one atomic pass (spec §3.4-P3). The promotion DECISION (threshold,
   * transient-service detection, next-tier) is the pure `npc-promotion` domain
   * service; this port only persists the resulting writes. `presentCharacters`
   * are the rows read before the bump (their counts are pre-increment).
   */
  recordAppearancesAndAutoPromote(
    worldId: number,
    presentCharacters: Character[],
    turnId: number,
  ): Promise<AppearancePromotionResult>
}
