import type { Character } from '@/lib/world-state'

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
// Reads plus `add`, the bounded-world crew insert. Name resolution / alias merge /
// promotion are deciding logic that stays out of the adapter (P4). Async by
// mandate (spec §5.3).
export interface CharacterRepository {
  forWorld(worldId: number): Promise<Character[]>
  inPlace(worldId: number, placeId: number): Promise<Character[]>
  add(character: CharacterInput): Promise<{ id: number }>
}
