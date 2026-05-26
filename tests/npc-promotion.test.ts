import { beforeEach, describe, expect, it } from 'vitest'

import { applyArchivistPatch } from '@/lib/archivist'
import { getCharactersForWorld, insertTurn } from '@/lib/db'
import {
  NPC_AUTO_PROMOTE_THRESHOLD,
  recordAppearancesAndAutoPromote,
} from '@/lib/npc-promotion'
import { createWorld } from '@/lib/worlds'
import type { Character } from '@/lib/world-state'

function seedWorld(name: string): number {
  const world = createWorld({
    name,
    premise: 'An office.',
    initialState: {
      time: 'Morning',
      location: 'Covenant Security',
      identity: 'Engineer.',
      playerName: 'Andrew',
    },
  })
  insertTurn(world.id, 'assistant', 'seed turn', null)
  return world.id
}

function character(worldId: number, name: string): Character {
  return getCharactersForWorld(worldId).find((c) => c.name === name)!
}

describe('recordAppearancesAndAutoPromote', () => {
  let worldId: number
  let tickTurnId: number

  beforeEach(() => {
    worldId = seedWorld(`Promo-${Math.random()}`)
    tickTurnId = 0
    const turn = insertTurn(worldId, 'assistant', 'seed', null)
    applyArchivistPatch(worldId, turn.id, {
      characters: [
        { name: 'Marcus', description: 'Eng.', current_place_name: 'Covenant Security' },
        { name: 'Kyle', description: 'Eng.', current_place_name: 'Covenant Security' },
      ],
    })
  })

  function tick(present: Character[], turnId = ++tickTurnId) {
    return recordAppearancesAndAutoPromote(worldId, present, turnId)
  }

  it('bumps appearance_count by one per call for each present NPC', () => {
    const marcus = character(worldId, 'Marcus')
    expect(marcus.appearance_count).toBe(0)

    tick([marcus])
    expect(character(worldId, 'Marcus').appearance_count).toBe(1)

    tick([character(worldId, 'Marcus')])
    expect(character(worldId, 'Marcus').appearance_count).toBe(2)
  })

  it('auto-promotes from npc to local attention at the threshold', () => {
    const marcus = character(worldId, 'Marcus')
    expect(marcus.agency_level).toBe('npc')

    // First two calls: below threshold, no promotion.
    let result = tick([marcus])
    expect(result.promoted).toEqual([])
    result = tick([character(worldId, 'Marcus')])
    expect(result.promoted).toEqual([])
    expect(character(worldId, 'Marcus').agency_level).toBe('npc')

    // Third call: hits threshold, promotes.
    result = tick([character(worldId, 'Marcus')])
    expect(result.promoted).toEqual(['Marcus'])
    expect(character(worldId, 'Marcus').agency_level).toBe('local')
    expect(character(worldId, 'Marcus').appearance_count).toBe(NPC_AUTO_PROMOTE_THRESHOLD)
  })

  it('does not re-promote an already-local NPC', () => {
    // Cross the threshold to promote.
    for (let i = 0; i < NPC_AUTO_PROMOTE_THRESHOLD; i++) {
      tick([character(worldId, 'Marcus')])
    }
    expect(character(worldId, 'Marcus').agency_level).toBe('local')

    // Further calls keep counting but never re-emit "promoted".
    const result = tick([character(worldId, 'Marcus')])
    expect(result.promoted).toEqual([])
    expect(character(worldId, 'Marcus').appearance_count).toBe(NPC_AUTO_PROMOTE_THRESHOLD + 1)
  })

  it('skips the player and dead characters', () => {
    const all = getCharactersForWorld(worldId)
    const before = all.map((c) => ({ id: c.id, count: c.appearance_count }))

    tick(all)

    for (const row of getCharactersForWorld(worldId)) {
      const prev = before.find((b) => b.id === row.id)!
      if (row.is_player === 1) {
        expect(row.appearance_count).toBe(prev.count) // player skipped
      } else {
        expect(row.appearance_count).toBe(prev.count + 1)
      }
    }
  })

  it('counted reflects the number of eligible NPCs (excludes player)', () => {
    const all = getCharactersForWorld(worldId)
    const result = tick(all)
    expect(result.counted).toBe(all.filter((c) => c.is_player === 0).length)
  })

  it('empty present set does not promote or count anyone', () => {
    const result = tick([])
    expect(result.promoted).toEqual([])
    expect(result.counted).toBe(0)
  })

  it('promotes multiple NPCs in the same call', () => {
    // Drive both Marcus and Kyle to threshold-1.
    for (let i = 0; i < NPC_AUTO_PROMOTE_THRESHOLD - 1; i++) {
      tick([
        character(worldId, 'Marcus'),
        character(worldId, 'Kyle'),
      ])
    }
    expect(character(worldId, 'Marcus').agency_level).toBe('npc')
    expect(character(worldId, 'Kyle').agency_level).toBe('npc')

    const result = tick([
      character(worldId, 'Marcus'),
      character(worldId, 'Kyle'),
    ])
    expect(result.promoted.sort()).toEqual(['Kyle', 'Marcus'])
    expect(character(worldId, 'Marcus').agency_level).toBe('local')
    expect(character(worldId, 'Kyle').agency_level).toBe('local')
  })

  it('cools off local NPCs as they spend turns away from the protagonist', () => {
    for (let i = 0; i < NPC_AUTO_PROMOTE_THRESHOLD; i++) {
      tick([character(worldId, 'Marcus')])
    }
    expect(character(worldId, 'Marcus').agency_level).toBe('local')

    tick([], 4)
    expect(character(worldId, 'Marcus').agency_level).toBe('nearby')

    tick([], 8)
    expect(character(worldId, 'Marcus').agency_level).toBe('distant')

    tick([], 15)
    expect(character(worldId, 'Marcus').agency_level).toBe('dormant')

    tick([], 25)
    expect(character(worldId, 'Marcus').agency_level).toBe('npc')
  })
})
