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

  beforeEach(() => {
    worldId = seedWorld(`Promo-${Math.random()}`)
    const turn = insertTurn(worldId, 'assistant', 'seed', null)
    applyArchivistPatch(worldId, turn.id, {
      characters: [
        { name: 'Marcus', description: 'Eng.', current_place_name: 'Covenant Security' },
        { name: 'Kyle', description: 'Eng.', current_place_name: 'Covenant Security' },
      ],
    })
  })

  it('bumps appearance_count by one per call for each present NPC', () => {
    const marcus = character(worldId, 'Marcus')
    expect(marcus.appearance_count).toBe(0)

    recordAppearancesAndAutoPromote([marcus])
    expect(character(worldId, 'Marcus').appearance_count).toBe(1)

    recordAppearancesAndAutoPromote([character(worldId, 'Marcus')])
    expect(character(worldId, 'Marcus').appearance_count).toBe(2)
  })

  it('auto-promotes from npc to agent at the threshold', () => {
    const marcus = character(worldId, 'Marcus')
    expect(marcus.agency_level).toBe('npc')

    // First two calls: below threshold, no promotion.
    let result = recordAppearancesAndAutoPromote([marcus])
    expect(result.promoted).toEqual([])
    result = recordAppearancesAndAutoPromote([character(worldId, 'Marcus')])
    expect(result.promoted).toEqual([])
    expect(character(worldId, 'Marcus').agency_level).toBe('npc')

    // Third call: hits threshold, promotes.
    result = recordAppearancesAndAutoPromote([character(worldId, 'Marcus')])
    expect(result.promoted).toEqual(['Marcus'])
    expect(character(worldId, 'Marcus').agency_level).toBe('agent')
    expect(character(worldId, 'Marcus').appearance_count).toBe(NPC_AUTO_PROMOTE_THRESHOLD)
  })

  it('does not re-promote an already-agent NPC', () => {
    // Cross the threshold to promote.
    for (let i = 0; i < NPC_AUTO_PROMOTE_THRESHOLD; i++) {
      recordAppearancesAndAutoPromote([character(worldId, 'Marcus')])
    }
    expect(character(worldId, 'Marcus').agency_level).toBe('agent')

    // Further calls keep counting but never re-emit "promoted".
    const result = recordAppearancesAndAutoPromote([character(worldId, 'Marcus')])
    expect(result.promoted).toEqual([])
    expect(character(worldId, 'Marcus').appearance_count).toBe(NPC_AUTO_PROMOTE_THRESHOLD + 1)
  })

  it('skips the player and dead characters', () => {
    const all = getCharactersForWorld(worldId)
    const before = all.map((c) => ({ id: c.id, count: c.appearance_count }))

    recordAppearancesAndAutoPromote(all)

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
    const result = recordAppearancesAndAutoPromote(all)
    expect(result.counted).toBe(all.filter((c) => c.is_player === 0).length)
  })

  it('empty present set is a no-op', () => {
    const result = recordAppearancesAndAutoPromote([])
    expect(result).toEqual({ promoted: [], counted: 0 })
  })

  it('promotes multiple NPCs in the same call', () => {
    // Drive both Marcus and Kyle to threshold-1.
    for (let i = 0; i < NPC_AUTO_PROMOTE_THRESHOLD - 1; i++) {
      recordAppearancesAndAutoPromote([
        character(worldId, 'Marcus'),
        character(worldId, 'Kyle'),
      ])
    }
    expect(character(worldId, 'Marcus').agency_level).toBe('npc')
    expect(character(worldId, 'Kyle').agency_level).toBe('npc')

    const result = recordAppearancesAndAutoPromote([
      character(worldId, 'Marcus'),
      character(worldId, 'Kyle'),
    ])
    expect(result.promoted.sort()).toEqual(['Kyle', 'Marcus'])
    expect(character(worldId, 'Marcus').agency_level).toBe('agent')
    expect(character(worldId, 'Kyle').agency_level).toBe('agent')
  })
})
