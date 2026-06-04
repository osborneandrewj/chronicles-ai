import type { Character } from '@/lib/world-state'

// CharacterRepository (spec §3.4) — dumb CRUD reads over the `characters`
// aggregate. Name resolution / alias merge / promotion are deciding logic that
// stays out of the adapter (P4). Async by mandate (spec §5.3).
export interface CharacterRepository {
  forWorld(worldId: number): Promise<Character[]>
  inPlace(worldId: number, placeId: number): Promise<Character[]>
}
