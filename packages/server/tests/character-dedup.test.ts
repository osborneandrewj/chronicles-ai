import { describe, expect, it } from 'vitest'

import { applyArchivistPatch } from '@/lib/archivist'
import { findLikelyDuplicateCharacters } from '@/lib/character-dedup'
import { db, insertTurn, type Character } from '@/lib/db'
import { addReveriesForCharacter, getReveriesForCharacter } from '@/lib/reveries'
import { getFullWorldState } from '@/lib/world-state'
import { createWorld } from '@/lib/worlds'

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

  it('flags a near-identical normalized name at different places', () => {
    const chars = [
      ch({ id: 1, name: 'Marco, Reeves', current_place_id: 1 }),
      ch({ id: 2, name: 'Marco Reeves', current_place_id: 9 }),
    ]
    const pairs = findLikelyDuplicateCharacters(chars)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].reason).toBe('near-identical name')
  })

  it('flags a pair that shares a distinctive memorable fact', () => {
    const fact = 'carries Jérôme Moreau key ring including a vehicle fob [t:454]'
    const chars = [
      ch({ id: 1, name: 'Andrew', current_place_id: 1, memorable_facts: fact }),
      ch({ id: 2, name: 'Andy', current_place_id: 9, observations: fact }),
    ]
    const pairs = findLikelyDuplicateCharacters(chars)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].reason).toBe('shared memorable fact')
  })

  it('excludes the player and dead characters', () => {
    const chars = [
      ch({ id: 1, name: 'Helena', is_player: 1, current_place_id: 5 }),
      ch({ id: 2, name: 'Alice', current_place_id: 5 }),
      ch({ id: 3, name: 'The Corpse', current_place_id: 5, status: 'dead' }),
    ]
    expect(findLikelyDuplicateCharacters(chars)).toHaveLength(0)
  })

  it('flags more than one is_player row (single-player invariant)', () => {
    const chars = [
      ch({ id: 1, name: 'Andrew Osborne', is_player: 1 }),
      ch({ id: 2, name: 'Andrew', is_player: 1 }),
    ]
    const pairs = findLikelyDuplicateCharacters(chars)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ aId: 1, bId: 2, reason: 'multiple player rows' })
  })

  it('flags a stray non-player "Player" row to fold into the protagonist', () => {
    const chars = [
      ch({ id: 1, name: 'Andrew Osborne', is_player: 1 }),
      ch({ id: 2, name: 'Player', is_player: 0, memorable_facts: 'holds the Matrix notes' }),
    ]
    const pairs = findLikelyDuplicateCharacters(chars)
    expect(pairs.some((p) => p.reason === 'stray pseudo-player row' && p.bId === 2)).toBe(true)
  })

  it('does not flag a normal cast around a single player', () => {
    const chars = [
      ch({ id: 1, name: 'Helena', is_player: 1 }),
      ch({ id: 2, name: 'Marcus', current_place_id: 5 }),
    ]
    expect(findLikelyDuplicateCharacters(chars)).toHaveLength(0)
  })
})

describe('getFullWorldState.potentialDuplicates', () => {
  it('flags a descriptor + named pair at the same place', async () => {
    const world = createWorld({
      name: `Dup-${Math.random()}`,
      premise: 'x',
      initialState: { time: 't', location: 'Cornavin station', identity: 'i', playerName: 'Andrew' },
    })
    await applyArchivistPatch(world.id, 1, {
      characters: [
        { name: 'The Attendant at the Gates', current_place_name: 'Cornavin station' },
        { name: 'Jérôme Moreau', current_place_name: 'Cornavin station' },
      ],
    })
    const dup = getFullWorldState(world.id).potentialDuplicates
    expect(dup.some((p) => p.reason === 'descriptor + named at same place')).toBe(true)
  })
})

describe('single-player invariant (self-naming)', () => {
  it('renames the player row in place instead of inserting a second protagonist', async () => {
    const world = createWorld({
      name: `Self-name-${Math.random()}`,
      premise: 'x',
      // Default-ish placeholder protagonist name.
      initialState: { time: 't', location: 'Bridge', identity: 'i', playerName: 'You' },
    })
    // The archivist learns the protagonist's name and marks them the player.
    await applyArchivistPatch(world.id, 1, {
      characters: [{ name: 'Andrew Osborne', is_player: true }],
    })
    const players = db
      .prepare('SELECT id, name FROM characters WHERE world_id = ? AND is_player = 1')
      .all(world.id) as Array<{ id: number; name: string }>
    expect(players).toHaveLength(1)
    expect(players[0].name).toBe('Andrew Osborne')
    // No stray non-player "You" row left behind.
    const strays = db
      .prepare("SELECT COUNT(*) AS n FROM characters WHERE world_id = ? AND is_player = 0 AND lower(name) = 'you'")
      .get(world.id) as { n: number }
    expect(strays.n).toBe(0)
  })

  it('folds a stray non-player matching the new name into the one protagonist', async () => {
    const world = createWorld({
      name: `Self-name-merge-${Math.random()}`,
      premise: 'x',
      initialState: { time: 't', location: 'Bridge', identity: 'i', playerName: 'You' },
    })
    // A stray NPC row named like the eventual protagonist sneaks in first.
    await applyArchivistPatch(world.id, 1, {
      characters: [{ name: 'Andrew', current_place_name: 'Bridge' }],
    })
    // Then the protagonist is named — must collapse onto the single player row.
    await applyArchivistPatch(world.id, 2, {
      characters: [{ name: 'Andrew', is_player: true }],
    })
    const players = db
      .prepare('SELECT id FROM characters WHERE world_id = ? AND is_player = 1')
      .all(world.id) as Array<{ id: number }>
    expect(players).toHaveLength(1)
    const named = db
      .prepare("SELECT COUNT(*) AS n FROM characters WHERE world_id = ? AND lower(name) = 'andrew'")
      .get(world.id) as { n: number }
    expect(named.n).toBe(1)
  })
})

describe('mergeCharacters reveries', () => {
  it('merges reveries by re-pointing rows, deduped', async () => {
    const world = createWorld({
      name: `Rev-merge-${Math.random()}`,
      premise: 'x',
      initialState: { time: 't', location: 'Cornavin station', identity: 'i', playerName: 'Andrew' },
    })
    const turnId = insertTurn(world.id, 'assistant', 'x', null).id

    // Seed two duplicate NPC rows (target "Robert", source "Bob") with
    // non-overlapping names so the soft-matcher won't auto-merge before we do.
    await applyArchivistPatch(world.id, turnId, {
      characters: [
        { name: 'Robert', current_place_name: 'Cornavin station' },
        { name: 'Bob', current_place_name: 'Cornavin station' },
      ],
    })
    const idOf = (name: string): number =>
      (db
        .prepare('SELECT id FROM characters WHERE world_id = ? AND lower(name) = lower(?)')
        .get(world.id, name) as { id: number }).id
    const targetId = idOf('Robert')
    const sourceId = idOf('Bob')

    addReveriesForCharacter(world.id, targetId, [{ text: 'shared' }], turnId)
    addReveriesForCharacter(world.id, sourceId, [{ text: 'shared' }, { text: 'only-source' }], turnId)

    // Public dedup path: the correction-channel `aliases` field asserts that
    // "Bob" is the same row as "Robert", driving runAliasMerges -> mergeCharacters.
    await applyArchivistPatch(world.id, turnId, {
      characters: [{ name: 'Robert', aliases: ['Bob'] }],
    })

    const texts = getReveriesForCharacter(targetId).map((r) => r.text).sort()
    expect(texts).toEqual(['only-source', 'shared'])
  })
})
