import { describe, expect, it } from 'vitest'

import { findLikelyDuplicateCharacters } from '@/lib/character-dedup'
import type { Character } from '@/lib/db'

// Minimal Character factory — only the fields the detector reads matter; cast
// through unknown so we don't have to fill every column.
function ch(over: Partial<Character>): Character {
  return {
    id: 0, world_id: 1, name: 'X', is_player: 0, current_place_id: null,
    status: 'active', memorable_facts: null, observations: null,
    ...over,
  } as unknown as Character
}

describe('findLikelyDuplicateCharacters', () => {
  it('flags a descriptor + named pair at the same place', () => {
    const chars = [
      ch({ id: 61, name: 'The Attendant at the Gates', current_place_id: 35 }),
      ch({ id: 62, name: 'Jérôme Moreau', current_place_id: 35 }),
    ]
    const pairs = findLikelyDuplicateCharacters(chars)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ aId: 61, bId: 62, reason: 'descriptor + named at same place' })
  })

  it('does NOT flag two distinct proper-named NPCs at the same place', () => {
    const chars = [
      ch({ id: 1, name: 'Marco Reeves', current_place_id: 35 }),
      ch({ id: 2, name: 'Anaïs Bonnet', current_place_id: 35 }),
    ]
    expect(findLikelyDuplicateCharacters(chars)).toHaveLength(0)
  })

  it('flags a pair that shares a distinctive memorable fact', () => {
    const fact = 'carries Jérôme Moreau key ring including a vehicle fob [t:454]'
    const chars = [
      ch({ id: 1, name: 'Andrew', current_place_id: 1, memorable_facts: fact }),
      ch({ id: 2, name: 'Andy', current_place_id: 9, observations: fact }),
    ]
    const pairs = findLikelyDuplicateCharacters(chars)
    expect(pairs.some((p) => p.reason === 'shared memorable fact')).toBe(true)
  })

  it('excludes the player and dead characters', () => {
    const chars = [
      ch({ id: 1, name: 'The Player Ghost', is_player: 1, current_place_id: 5 }),
      ch({ id: 2, name: 'Alice', current_place_id: 5 }),
      ch({ id: 3, name: 'The Corpse', current_place_id: 5, status: 'dead' }),
    ]
    expect(findLikelyDuplicateCharacters(chars)).toHaveLength(0)
  })
})
