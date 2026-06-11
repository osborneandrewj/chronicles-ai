import { describe, expect, it } from 'vitest'

import { playerPossesses, resolvePossession } from '@/domain/services/inventory-resolution'
import type { NarratorWorldState } from '@/lib/world-state'

describe('resolvePossession', () => {
  it('leaves both columns unchanged when neither name is provided', () => {
    expect(
      resolvePossession({ heldByName: undefined, locationName: undefined, heldById: null, locationId: null }),
    ).toEqual({
      held_by_character_id: null,
      clear_held_by: false,
      location_place_id: null,
      clear_location: false,
    })
  })

  it('sets the holder and clears any resting location (picked up)', () => {
    expect(
      resolvePossession({ heldByName: 'protagonist', locationName: undefined, heldById: 7, locationId: null }),
    ).toEqual({
      held_by_character_id: 7,
      clear_held_by: false,
      location_place_id: null,
      clear_location: true,
    })
  })

  it('sets the location and clears the holder (dropped)', () => {
    expect(
      resolvePossession({ heldByName: undefined, locationName: 'Locker', heldById: null, locationId: 12 }),
    ).toEqual({
      held_by_character_id: null,
      clear_held_by: true,
      location_place_id: 12,
      clear_location: false,
    })
  })

  it('clears the holder when held_by_name is explicit null (lost)', () => {
    expect(
      resolvePossession({ heldByName: null, locationName: undefined, heldById: null, locationId: null }),
    ).toEqual({
      held_by_character_id: null,
      clear_held_by: true,
      location_place_id: null,
      clear_location: false,
    })
  })

  it('lets held_by win when a contradictory patch sets both', () => {
    expect(
      resolvePossession({ heldByName: 'Torres', locationName: 'Locker', heldById: 3, locationId: 9 }),
    ).toEqual({
      held_by_character_id: 3,
      clear_held_by: false,
      location_place_id: null,
      clear_location: true,
    })
  })

  it('treats an unresolved set-name as unchanged (no clobber on a typo)', () => {
    expect(
      resolvePossession({ heldByName: 'Nobody', locationName: undefined, heldById: null, locationId: null }),
    ).toEqual({
      held_by_character_id: null,
      clear_held_by: false,
      location_place_id: null,
      clear_location: false,
    })
  })
})

function stateWithResources(
  resources: Array<{ id: number; name: string; held_by_character_id: number | null }>,
): NarratorWorldState {
  const player = { id: 1, is_player: 1 }
  return {
    presentCharacters: [player],
    knownCharacters: [player],
    dossier: { threads: [], clues: [], objectives: [], resources, timeline: [] },
  } as unknown as NarratorWorldState
}

describe('playerPossesses', () => {
  it('matches a held object by partial (article-stripped) name', () => {
    const state = stateWithResources([{ id: 9, name: 'brass key', held_by_character_id: 1 }])
    expect(playerPossesses(state, 'the key')).toBe(true)
    expect(playerPossesses(state, 'key')).toBe(true)
  })

  it('is false when the object is held by someone else', () => {
    const state = stateWithResources([{ id: 9, name: 'brass key', held_by_character_id: 2 }])
    expect(playerPossesses(state, 'key')).toBe(false)
  })

  it('is false when the object is resting on the floor (no holder)', () => {
    const state = stateWithResources([{ id: 9, name: 'brass key', held_by_character_id: null }])
    expect(playerPossesses(state, 'key')).toBe(false)
  })

  it('is false for an object the protagonist never had', () => {
    const state = stateWithResources([{ id: 9, name: 'brass key', held_by_character_id: 1 }])
    expect(playerPossesses(state, 'pistol')).toBe(false)
  })
})
