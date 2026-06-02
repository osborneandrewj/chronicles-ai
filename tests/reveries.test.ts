import { beforeEach, describe, expect, it } from 'vitest'

import { db, insertTurn } from '@/lib/db'
import {
  addReveriesForCharacter,
  canMintReverie,
  computeReverieFlares,
  getReveriesForCharacter,
  MAX_REVERIES_PER_NPC,
  normalizeReverieTag,
  repointReveries,
  REVERIE_COOLDOWN_TURNS,
  reverieMintState,
} from '@/lib/reveries'
import { createWorld } from '@/lib/worlds'

describe('normalizeReverieTag', () => {
  it('lowercases, trims, and collapses internal whitespace', () => {
    expect(normalizeReverieTag('  Burnt   Coffee ')).toBe('burnt coffee')
  })
})

describe('computeReverieFlares', () => {
  const tags = (...t: string[]) => t
  it('flares the highest-scoring reverie per NPC with >=1 overlap', () => {
    const candidates = [
      { id: 1, character_id: 10, match_tags: tags('coffee', 'failure'), intensity: 0.4 },
      { id: 2, character_id: 10, match_tags: tags('rain'), intensity: 0.9 },
    ]
    const flaring = computeReverieFlares(candidates, ['coffee', 'failure', 'night'], {})
    expect(flaring).toEqual([1]) // 2 overlaps * 0.4 = 0.8 beats 0 overlaps * 0.9
  })

  it('drops reveries with zero tag overlap', () => {
    const candidates = [{ id: 1, character_id: 10, match_tags: tags('rain'), intensity: 1 }]
    expect(computeReverieFlares(candidates, ['coffee'], {})).toEqual([])
  })

  it('caps total flares per turn and prefers present NPCs', () => {
    const candidates = [
      { id: 1, character_id: 10, match_tags: tags('x'), intensity: 1 },
      { id: 2, character_id: 11, match_tags: tags('x'), intensity: 1 },
      { id: 3, character_id: 12, match_tags: tags('x'), intensity: 1 },
    ]
    const flaring = computeReverieFlares(candidates, ['x'], { perTurnCap: 2, presentCharacterIds: [12] })
    expect(flaring).toContain(3) // present NPC always included
    expect(flaring).toHaveLength(2)
  })
})

describe('canMintReverie', () => {
  it('allows the first reverie when the NPC has none', () => {
    expect(canMintReverie({ hasAny: false, playerTurnsSinceLast: 0 })).toBe(true)
  })
  it('blocks a new reverie within the cooldown window', () => {
    expect(canMintReverie({ hasAny: true, playerTurnsSinceLast: REVERIE_COOLDOWN_TURNS - 1 })).toBe(false)
  })
  it('allows a new reverie once the cooldown has elapsed', () => {
    expect(canMintReverie({ hasAny: true, playerTurnsSinceLast: REVERIE_COOLDOWN_TURNS })).toBe(true)
  })
})

describe('npc_reveries persistence', () => {
  let worldId: number
  let charId: number
  let turnId: number
  beforeEach(() => {
    const w = createWorld({
      name: `rev-${Math.round(performance.now())}-${process.hrtime.bigint()}`,
      premise: 'p',
      initialState: { time: 't', location: 'l', identity: 'i', playerName: 'P' },
    })
    worldId = w.id
    turnId = insertTurn(worldId, 'assistant', 'x', null).id
    charId = db
      .prepare("INSERT INTO characters (world_id, name, is_player) VALUES (?, 'Mara', 0) RETURNING id")
      .get(worldId) as unknown as number
    // RETURNING via .get returns an object; normalize:
    charId = (charId as unknown as { id: number }).id
  })

  it('appends new reveries and dedups by normalized text', () => {
    addReveriesForCharacter(worldId, charId, [{ text: 'Burnt coffee', match_tags: ['coffee'] }], turnId)
    addReveriesForCharacter(worldId, charId, [{ text: 'burnt   coffee', match_tags: ['x'] }], turnId)
    expect(getReveriesForCharacter(charId)).toHaveLength(1)
  })

  it('omitting reveries never deletes existing rows', () => {
    addReveriesForCharacter(worldId, charId, [{ text: 'a' }, { text: 'b' }], turnId)
    addReveriesForCharacter(worldId, charId, [], turnId)
    expect(getReveriesForCharacter(charId)).toHaveLength(2)
  })

  it('prunes to MAX_REVERIES_PER_NPC, evicting lowest intensity', () => {
    for (let i = 0; i < MAX_REVERIES_PER_NPC + 2; i++) {
      addReveriesForCharacter(worldId, charId, [{ text: `r${i}`, intensity: i === 0 ? 0.01 : 0.9 }], turnId)
    }
    const rows = getReveriesForCharacter(charId)
    expect(rows).toHaveLength(MAX_REVERIES_PER_NPC)
    expect(rows.map((r) => r.text)).not.toContain('r0') // weakest evicted
  })

  it('repoints rows on merge and dedups against target', () => {
    const otherId = (
      db.prepare("INSERT INTO characters (world_id, name, is_player) VALUES (?, 'Dup', 0) RETURNING id").get(worldId) as { id: number }
    ).id
    addReveriesForCharacter(worldId, charId, [{ text: 'shared' }], turnId)
    addReveriesForCharacter(worldId, otherId, [{ text: 'shared' }, { text: 'unique' }], turnId)
    repointReveries(otherId, charId)
    const texts = getReveriesForCharacter(charId).map((r) => r.text).sort()
    expect(texts).toEqual(['shared', 'unique'])
    expect(getReveriesForCharacter(otherId)).toHaveLength(0)
  })
})

describe('reverieMintState', () => {
  it('reports no reveries for a fresh NPC', () => {
    const world = createWorld({
      name: 'Mint State A',
      premise: 'Test.',
      initialState: { time: 'Day', location: 'Room', identity: 'X', playerName: 'P' },
    })
    const charId = db
      .prepare(`INSERT INTO characters (world_id, name, is_player, status) VALUES (?, 'Nyx', 0, 'active')`)
      .run(world.id).lastInsertRowid as number
    expect(reverieMintState(world.id, charId)).toEqual({ hasAny: false, playerTurnsSinceLast: Number.POSITIVE_INFINITY })
  })

  it('counts world player-turns since the NPC last minted a reverie', () => {
    const world = createWorld({
      name: 'Mint State B',
      premise: 'Test.',
      initialState: { time: 'Day', location: 'Room', identity: 'X', playerName: 'P' },
    })
    const charId = db
      .prepare(`INSERT INTO characters (world_id, name, is_player, status) VALUES (?, 'Nyx', 0, 'active')`)
      .run(world.id).lastInsertRowid as number
    const mintTurn = insertTurn(world.id, 'assistant', 'narration', null)
    addReveriesForCharacter(world.id, charId, [{ text: 'a smell of rain' }], mintTurn.id)
    insertTurn(world.id, 'user', 'p1', null)
    insertTurn(world.id, 'user', 'p2', null)
    const state = reverieMintState(world.id, charId)
    expect(state.hasAny).toBe(true)
    expect(state.playerTurnsSinceLast).toBe(2)
  })
})
