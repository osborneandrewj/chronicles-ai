import { beforeEach, describe, expect, it } from 'vitest'

import { applyArchivistPatch, type ArchivistPatch } from '@/lib/archivist'
import {
  db,
  getActiveSceneForWorld,
  getCharactersForWorld,
  getPlacesForWorld,
  getScenesForWorld,
  getWorldCursor,
  insertTurn,
} from '@/lib/db'
import { createWorld } from '@/lib/worlds'

// Each test gets its own world on the shared in-memory singleton. We never
// reset the singleton — better-sqlite3 has no concept of nested transactions
// across modules — so world-scoped isolation is the cleanest separation.
function seedWorld(name: string): { worldId: number; turnId: number } {
  const world = createWorld({
    name,
    premise: 'A coastal village in autumn 1897. The harbour braces for a storm.',
    initialState: {
      time: 'Late afternoon',
      location: 'Mevagissey harbour, Cornwall',
      identity: 'Travel-worn letter-writer.',
      playerName: 'Edith',
    },
  })
  const turn = insertTurn(world.id, 'assistant', 'The wind picks up.', null)
  return { worldId: world.id, turnId: turn.id }
}

describe('applyArchivistPatch', () => {
  let worldId: number
  let turnId: number

  beforeEach(() => {
    ;({ worldId, turnId } = seedWorld(`World-${Math.random()}`))
  })

  it('seed: createWorld produces one player, one place, scene 1 active', () => {
    const characters = getCharactersForWorld(worldId)
    expect(characters).toHaveLength(1)
    expect(characters[0].name).toBe('Edith')
    expect(characters[0].is_player).toBe(1)

    const places = getPlacesForWorld(worldId)
    expect(places).toHaveLength(1)
    expect(places[0].name).toBe('Mevagissey harbour')

    const scenes = getScenesForWorld(worldId)
    expect(scenes).toHaveLength(1)
    expect(scenes[0].status).toBe('active')

    const cursor = getWorldCursor(worldId)
    expect(cursor.world_time).toBe('Late afternoon')
    expect(cursor.current_scene_id).toBe(scenes[0].id)
  })

  it('empty patch is a no-op', () => {
    const before = {
      characters: getCharactersForWorld(worldId).length,
      places: getPlacesForWorld(worldId).length,
      scenes: getScenesForWorld(worldId).length,
      worldTime: getWorldCursor(worldId).world_time,
    }
    applyArchivistPatch(worldId, turnId, {})
    expect({
      characters: getCharactersForWorld(worldId).length,
      places: getPlacesForWorld(worldId).length,
      scenes: getScenesForWorld(worldId).length,
      worldTime: getWorldCursor(worldId).world_time,
    }).toEqual(before)
  })

  it('current_time updates the world clock', () => {
    applyArchivistPatch(worldId, turnId, { current_time: 'Dusk, lamps lit' })
    expect(getWorldCursor(worldId).world_time).toBe('Dusk, lamps lit')
  })

  it('inserts a new character with description and place', () => {
    const patch: ArchivistPatch = {
      characters: [
        {
          name: 'Tom Penhaligon',
          description: 'The harbourmaster. Pipe-smoker, gruff.',
          current_place_name: 'Mevagissey harbour',
        },
      ],
    }
    applyArchivistPatch(worldId, turnId, patch)

    const chars = getCharactersForWorld(worldId)
    expect(chars).toHaveLength(2)
    const tom = chars.find((c) => c.name === 'Tom Penhaligon')!
    expect(tom.is_player).toBe(0)
    expect(tom.description).toBe('The harbourmaster. Pipe-smoker, gruff.')
    expect(tom.status).toBe('active')

    const places = getPlacesForWorld(worldId)
    expect(tom.current_place_id).toBe(places.find((p) => p.name === 'Mevagissey harbour')!.id)
  })

  it('upserts character by case-insensitive name and preserves untouched fields', () => {
    applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Tom', description: 'A fisherman.' }],
    })
    applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'tom', status: 'inactive' }], // lowercase, different field
    })

    const chars = getCharactersForWorld(worldId)
    const tom = chars.find((c) => c.name === 'Tom')!
    expect(chars.filter((c) => c.name.toLowerCase() === 'tom')).toHaveLength(1) // no dup
    expect(tom.description).toBe('A fisherman.') // preserved
    expect(tom.status).toBe('inactive') // updated
  })

  it('appends memorable_facts with newline; multiple appends accumulate; each line suffixed with [t:N]', () => {
    applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Tom', memorable_facts_append: 'gave the player a silver locket' }],
    })
    applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Tom', memorable_facts_append: 'owes the harbourmaster two pounds' }],
    })

    const tom = getCharactersForWorld(worldId).find((c) => c.name === 'Tom')!
    expect(tom.memorable_facts).toBe(
      `gave the player a silver locket [t:${turnId}]\nowes the harbourmaster two pounds [t:${turnId}]`,
    )
  })

  it('different turn ids produce different [t:N] suffixes on memorable_facts', () => {
    applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Tom', memorable_facts_append: 'first fact' }],
    })
    const secondTurn = insertTurn(worldId, 'assistant', 'Another turn.', null)
    applyArchivistPatch(worldId, secondTurn.id, {
      characters: [{ name: 'Tom', memorable_facts_append: 'second fact' }],
    })

    const tom = getCharactersForWorld(worldId).find((c) => c.name === 'Tom')!
    expect(tom.memorable_facts).toBe(
      `first fact [t:${turnId}]\nsecond fact [t:${secondTurn.id}]`,
    )
  })

  it('upserts place by case-insensitive name; idempotent on repeat', () => {
    applyArchivistPatch(worldId, turnId, { places: [{ name: 'The Ship Inn', kind: 'tavern' }] })
    applyArchivistPatch(worldId, turnId, {
      places: [{ name: 'the ship inn', description: 'Smoky front room.' }],
    })

    const places = getPlacesForWorld(worldId)
    const inn = places.find((p) => p.name === 'The Ship Inn')!
    expect(places.filter((p) => p.name.toLowerCase() === 'the ship inn')).toHaveLength(1)
    expect(inn.kind).toBe('tavern') // preserved
    expect(inn.description).toBe('Smoky front room.') // updated on second call
  })

  it("closes the active scene with a summary and turn pointer", () => {
    const scene = getActiveSceneForWorld(worldId)!
    applyArchivistPatch(worldId, turnId, {
      scene: { action: 'close', summary: 'Edith stepped onto the quay and the lamp went out.' },
    })

    const row = db
      .prepare(
        'SELECT status, summary, closed_at_turn FROM scenes WHERE id = ?',
      )
      .get(scene.id) as { status: string; summary: string; closed_at_turn: number }
    expect(row.status).toBe('completed')
    expect(row.summary).toBe('Edith stepped onto the quay and the lamp went out.')
    expect(row.closed_at_turn).toBe(turnId)
  })

  it("opens a new scene; auto-closes the prior active scene and advances the world cursor", () => {
    const priorScene = getActiveSceneForWorld(worldId)!
    applyArchivistPatch(worldId, turnId, {
      scene: { action: 'open', title: 'Inside the Ship Inn', place_name: 'The Ship Inn' },
    })

    const scenes = getScenesForWorld(worldId)
    expect(scenes).toHaveLength(2)
    const closed = scenes.find((s) => s.id === priorScene.id)!
    const next = scenes.find((s) => s.id !== priorScene.id)!
    expect(closed.status).toBe('completed')
    expect(next.status).toBe('active')
    expect(next.scene_number).toBe(2)
    expect(next.title).toBe('Inside the Ship Inn')

    const cursor = getWorldCursor(worldId)
    expect(cursor.current_scene_id).toBe(next.id)

    // The new scene's place was upserted.
    const places = getPlacesForWorld(worldId)
    expect(places.some((p) => p.name === 'The Ship Inn')).toBe(true)
  })

  it("'keep_open' is a no-op for scenes", () => {
    const before = getScenesForWorld(worldId).map((s) => ({ id: s.id, status: s.status }))
    applyArchivistPatch(worldId, turnId, { scene: { action: 'keep_open' } })
    expect(getScenesForWorld(worldId).map((s) => ({ id: s.id, status: s.status }))).toEqual(before)
  })

  it('resolves character current_place_name against places listed earlier in the same patch', () => {
    applyArchivistPatch(worldId, turnId, {
      places: [{ name: 'Lighthouse Cliff' }],
      characters: [{ name: 'Old Bran', current_place_name: 'Lighthouse Cliff' }],
    })
    const bran = getCharactersForWorld(worldId).find((c) => c.name === 'Old Bran')!
    const cliff = getPlacesForWorld(worldId).find((p) => p.name === 'Lighthouse Cliff')!
    expect(bran.current_place_id).toBe(cliff.id)
  })
})
