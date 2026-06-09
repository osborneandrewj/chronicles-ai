import { beforeEach, describe, expect, it } from 'vitest'

import {
  applyArchivistPatch,
  buildArchivistUserContent,
  extractDeterministicPatch,
  normalizeTransitPlaceName,
  PLACE_KIND_DIRECTIVE,
  sanitizeArchivistPatch,
  THREAD_MANDATE_DIRECTIVE,
  type ArchivistPatch,
} from '@/lib/archivist'
import {
  db,
  getActiveSceneForWorld,
  getCharactersForWorld,
  getPlacesForWorld,
  getScenesForWorld,
  getStoryDossierForWorld,
  getWorldCursor,
  insertTurn,
} from '@/lib/db'
import { createWorld } from '@/lib/worlds'
import { getNarratorWorldState } from '@/lib/world-state'

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

describe('buildArchivistUserContent (opening bootstrap, A)', () => {
  const base = { priorBlock: '{"world_time":"dusk"}', transcript: 'NARRATOR: Rain falls.', occupancyBlock: '' }

  it('includes the thread mandate on the opening turn', () => {
    expect(buildArchivistUserContent({ ...base, threadMandate: true, placeKindMandate: true })).toContain(THREAD_MANDATE_DIRECTIVE)
    expect(buildArchivistUserContent({ ...base, threadMandate: false, placeKindMandate: false })).not.toContain(THREAD_MANDATE_DIRECTIVE)
  })

  it('always carries the prior state and transcript and ends with the return instruction', () => {
    const content = buildArchivistUserContent({ ...base, threadMandate: false, placeKindMandate: false })
    expect(content).toContain(base.priorBlock)
    expect(content).toContain(base.transcript)
    expect(content.trimEnd().endsWith('Return the patch.')).toBe(true)
  })
})

describe('archivist directive assembly', () => {
  const base = { priorBlock: '{}', transcript: 'PLAYER: x', occupancyBlock: '' }

  it('injects only the thread mandate when bootstrapping a non-opening empty dossier', () => {
    const content = buildArchivistUserContent({ ...base, threadMandate: true, placeKindMandate: false })
    expect(content).toContain(THREAD_MANDATE_DIRECTIVE)
    expect(content).not.toContain(PLACE_KIND_DIRECTIVE)
  })

  it('injects both mandates on the true opening turn', () => {
    const content = buildArchivistUserContent({ ...base, threadMandate: true, placeKindMandate: true })
    expect(content).toContain(THREAD_MANDATE_DIRECTIVE)
    expect(content).toContain(PLACE_KIND_DIRECTIVE)
  })

  it('injects neither on a routine turn', () => {
    const content = buildArchivistUserContent({ ...base, threadMandate: false, placeKindMandate: false })
    expect(content).not.toContain(THREAD_MANDATE_DIRECTIVE)
    expect(content).not.toContain(PLACE_KIND_DIRECTIVE)
  })
})

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

  it('empty patch is a no-op', async () => {
    const before = {
      characters: getCharactersForWorld(worldId).length,
      places: getPlacesForWorld(worldId).length,
      scenes: getScenesForWorld(worldId).length,
      worldTime: getWorldCursor(worldId).world_time,
    }
    await applyArchivistPatch(worldId, turnId, {})
    expect({
      characters: getCharactersForWorld(worldId).length,
      places: getPlacesForWorld(worldId).length,
      scenes: getScenesForWorld(worldId).length,
      worldTime: getWorldCursor(worldId).world_time,
    }).toEqual(before)
  })

  it('current_time updates the world clock', async () => {
    await applyArchivistPatch(worldId, turnId, { current_time: 'Dusk, lamps lit' })
    expect(getWorldCursor(worldId).world_time).toBe('Dusk, lamps lit')
  })

  it('applies story dossier threads, clues, objectives, resources, and timeline events', async () => {
    await applyArchivistPatch(worldId, turnId, {
      story_threads: [
        {
          title: 'Identify the relay fragment',
          kind: 'quest',
          summary: 'A fresh Imperial fragment was found in the field.',
          stakes: 'Whoever planted it may still be nearby.',
          rewards: 'Finding the source establishes Voss as competent.',
          consequences: 'Delay lets the saboteur erase the signal trail.',
          hidden: 'The fragment is part of an off-book relay network.',
        },
      ],
      story_clues: [
        {
          title: 'Mark VIIc casing',
          thread_title: 'Identify the relay fragment',
          detail: 'Vox matched the fragment to a Mark VIIc vox-relay array.',
          implication: 'The nearby spire may be transmitting.',
        },
      ],
      story_objectives: [
        {
          title: 'Check the spire',
          thread_title: 'Identify the relay fragment',
          detail: 'Reach the spire and test for relay traffic.',
        },
      ],
      story_resources: [
        {
          name: 'Vox',
          kind: 'companion scanner',
          status: 'active',
          detail: 'Can run technical pattern matches.',
        },
      ],
      timeline_events: [
        {
          title: 'Relay fragment identified',
          thread_title: 'Identify the relay fragment',
          summary: 'Vox matched the field fragment to Imperial relay hardware.',
          importance: 4,
        },
      ],
    })

    const dossier = getStoryDossierForWorld(worldId)
    expect(dossier.threads).toHaveLength(1)
    expect(dossier.threads[0]).toMatchObject({
      title: 'Identify the relay fragment',
      kind: 'quest',
      status: 'active',
      rewards: 'Finding the source establishes Voss as competent.',
      consequences: 'Delay lets the saboteur erase the signal trail.',
      hidden: 'The fragment is part of an off-book relay network.',
    })
    expect(dossier.clues[0]).toMatchObject({
      title: 'Mark VIIc casing',
      thread_title: 'Identify the relay fragment',
      status: 'open',
    })
    expect(dossier.objectives[0]).toMatchObject({
      title: 'Check the spire',
      thread_title: 'Identify the relay fragment',
      status: 'active',
    })
    expect(dossier.resources[0]).toMatchObject({
      name: 'Vox',
      kind: 'companion scanner',
      status: 'active',
    })
    expect(dossier.timeline[0]).toMatchObject({
      title: 'Relay fragment identified',
      thread_title: 'Identify the relay fragment',
      importance: 4,
    })
  })

  it('classifies objective-bearing threads as quests (new + mystery upgrade), but leaves threats alone', async () => {
    await applyArchivistPatch(worldId, turnId, {
      // A bare objective referencing a brand-new thread title (no thread row).
      story_objectives: [{ title: 'Reach the spire', thread_title: 'The Spire Signal' }],
      // Threads the model labelled itself; objectives attach on the next turn.
      story_threads: [
        { title: 'The Dead Forge', kind: 'mystery', summary: 'The furnaces went cold.' },
        { title: 'The Hostage Standoff', kind: 'threat', summary: 'A captor makes demands.' },
      ],
    })
    await applyArchivistPatch(worldId, turnId, {
      story_objectives: [
        { title: 'Assess the silence', thread_title: 'The Dead Forge' },
        { title: 'Stall the captor', thread_title: 'The Hostage Standoff' },
      ],
    })

    const threads = getStoryDossierForWorld(worldId).threads
    // Objective-spawned thread opens as a quest.
    expect(threads.find((t) => t.title === 'The Spire Signal')!.kind).toBe('quest')
    // A mystery that gains an objective is upgraded to a quest.
    expect(threads.find((t) => t.title === 'The Dead Forge')!.kind).toBe('quest')
    // A deliberate threat keeps its kind even with an objective attached.
    expect(threads.find((t) => t.title === 'The Hostage Standoff')!.kind).toBe('threat')
  })

  it('inserts a new character with description and place', async () => {
    const patch: ArchivistPatch = {
      characters: [
        {
          name: 'Tom Penhaligon',
          description: 'The harbourmaster. Pipe-smoker, gruff.',
          current_place_name: 'Mevagissey harbour',
        },
      ],
    }
    await applyArchivistPatch(worldId, turnId, patch)

    const chars = getCharactersForWorld(worldId)
    expect(chars).toHaveLength(2)
    const tom = chars.find((c) => c.name === 'Tom Penhaligon')!
    expect(tom.is_player).toBe(0)
    expect(tom.description).toBe('The harbourmaster. Pipe-smoker, gruff.')
    expect(tom.status).toBe('active')

    const places = getPlacesForWorld(worldId)
    expect(tom.current_place_id).toBe(places.find((p) => p.name === 'Mevagissey harbour')!.id)
  })

  it('upserts character by case-insensitive name and preserves untouched fields', async () => {
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Tom', description: 'A fisherman.' }],
    })
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'tom', status: 'inactive' }], // lowercase, different field
    })

    const chars = getCharactersForWorld(worldId)
    const tom = chars.find((c) => c.name === 'Tom')!
    expect(chars.filter((c) => c.name.toLowerCase() === 'tom')).toHaveLength(1) // no dup
    expect(tom.description).toBe('A fisherman.') // preserved
    expect(tom.status).toBe('inactive') // updated
  })

  it('canonicalizes short/full character names onto one row', async () => {
    await applyArchivistPatch(worldId, turnId, {
      characters: [
        {
          name: 'Marcus',
          description: 'Andrew peer at Covenant Security.',
          active_goal: 'monitor Andrew',
        },
      ],
    })
    await applyArchivistPatch(worldId, turnId, {
      characters: [
        {
          name: 'Marcus Reeves',
          description: 'Andrew peer at Covenant Security who called Jordana.',
          current_attitude: 'resolute',
        },
      ],
    })

    const chars = getCharactersForWorld(worldId)
    const marcusRows = chars.filter((c) => c.name === 'Marcus' || c.name === 'Marcus Reeves')
    expect(marcusRows).toHaveLength(1)
    expect(marcusRows[0].description).toBe(
      'Andrew peer at Covenant Security who called Jordana.',
    )
    expect(marcusRows[0].active_goal).toBe('monitor Andrew')
    expect(marcusRows[0].current_attitude).toBe('resolute')
  })

  it('canonicalizes full/short character names onto one row', async () => {
    await applyArchivistPatch(worldId, turnId, {
      characters: [
        {
          name: 'Jordana Osborne',
          description: "Andrew's wife.",
          current_attitude: 'worried',
        },
      ],
    })
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Jordana', active_goal: 'reach Andrew at work' }],
    })

    const jordanaRows = getCharactersForWorld(worldId).filter((c) =>
      ['Jordana', 'Jordana Osborne'].includes(c.name),
    )
    expect(jordanaRows).toHaveLength(1)
    expect(jordanaRows[0].current_attitude).toBe('worried')
    expect(jordanaRows[0].active_goal).toBe('reach Andrew at work')
  })

  it('does not soft-merge an ambiguous short character name', async () => {
    await applyArchivistPatch(worldId, turnId, {
      characters: [
        { name: 'Marcus Reeves', description: 'One coworker.' },
        { name: 'Marcus Bell', description: 'Another coworker.' },
      ],
    })
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Marcus', description: 'Ambiguous Marcus reference.' }],
    })

    const marcusRows = getCharactersForWorld(worldId).filter((c) =>
      c.name.startsWith('Marcus'),
    )
    expect(marcusRows).toHaveLength(3)
  })

  it('renames a descriptor NPC to a revealed proper name via aliases, with no duplicate row', async () => {
    // An agentic, descriptor-named NPC the player has been interrogating.
    await applyArchivistPatch(worldId, turnId, {
      characters: [
        { name: 'The Attendant at the Gates', description: 'Station attendant.', current_attitude: 'terrified' },
      ],
    })
    db.prepare(
      "UPDATE characters SET agency_level = 'local' WHERE world_id = ? AND lower(name) = lower('The Attendant at the Gates')",
    ).run(worldId)

    // The reveal turn: the descriptor figure gives a proper name. The archivist
    // is expected to rename-and-alias the SAME row (not mint a new one) — the
    // exact shape prompt rule "A revealed name is the same person" requires.
    await applyArchivistPatch(worldId, turnId, {
      characters: [
        {
          name: 'Jérôme Moreau',
          aliases: ['The Attendant at the Gates'],
          description: 'Cornavin station maintenance staff; has a daughter.',
          active_goal: 'survive',
        },
      ],
    })

    const matches = getCharactersForWorld(worldId).filter((c) =>
      ['Jérôme Moreau', 'The Attendant at the Gates'].includes(c.name),
    )
    expect(matches).toHaveLength(1) // merged, not duplicated
    expect(matches[0].name).toBe('Jérôme Moreau')
    expect(matches[0].agency_level).toBe('local') // agentic identity preserved
    expect(matches[0].aliases ?? '').toContain('The Attendant at the Gates')
  })

  it('reveals_name_of renames a descriptor row to the proper name, no duplicate', async () => {
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'The Attendant at the Gates', description: 'Station attendant.' }],
    })
    db.prepare(
      "UPDATE characters SET agency_level = 'local' WHERE world_id = ? AND lower(name) = lower('The Attendant at the Gates')",
    ).run(worldId)

    await applyArchivistPatch(worldId, turnId, {
      characters: [
        { name: 'Jérôme Moreau', reveals_name_of: 'The Attendant at the Gates', active_goal: 'survive' },
      ],
    })

    const matches = getCharactersForWorld(worldId).filter((c) =>
      ['Jérôme Moreau', 'The Attendant at the Gates'].includes(c.name),
    )
    expect(matches).toHaveLength(1)
    expect(matches[0].name).toBe('Jérôme Moreau')
    expect(matches[0].agency_level).toBe('local')
    expect(matches[0].aliases ?? '').toContain('The Attendant at the Gates')
  })

  it('appends memorable_facts with newline; multiple appends accumulate; each line suffixed with [t:N]', async () => {
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Tom', memorable_facts_append: 'gave the player a silver locket' }],
    })
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Tom', memorable_facts_append: 'owes the harbourmaster two pounds' }],
    })

    const tom = getCharactersForWorld(worldId).find((c) => c.name === 'Tom')!
    expect(tom.memorable_facts).toBe(
      `gave the player a silver locket [t:${turnId}]\nowes the harbourmaster two pounds [t:${turnId}]`,
    )
  })

  it('different turn ids produce different [t:N] suffixes on memorable_facts', async () => {
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Tom', memorable_facts_append: 'first fact' }],
    })
    const secondTurn = insertTurn(worldId, 'assistant', 'Another turn.', null)
    await applyArchivistPatch(worldId, secondTurn.id, {
      characters: [{ name: 'Tom', memorable_facts_append: 'second fact' }],
    })

    const tom = getCharactersForWorld(worldId).find((c) => c.name === 'Tom')!
    expect(tom.memorable_facts).toBe(
      `first fact [t:${turnId}]\nsecond fact [t:${secondTurn.id}]`,
    )
  })

  it('appends observations on NPC insert and on subsequent update; each line suffixed with [t:N]', async () => {
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Tom', observations_append: 'noticed Edith repeated the same question' }],
    })
    const secondTurn = insertTurn(worldId, 'assistant', 'Another turn.', null)
    await applyArchivistPatch(worldId, secondTurn.id, {
      characters: [{ name: 'Tom', observations_append: 'watched Edith stare at the lamp without answering' }],
    })

    const tom = getCharactersForWorld(worldId).find((c) => c.name === 'Tom')!
    expect(tom.observations).toBe(
      `noticed Edith repeated the same question [t:${turnId}]\nwatched Edith stare at the lamp without answering [t:${secondTurn.id}]`,
    )
  })

  it('observations_append on the player is dropped silently (NPC-only field)', async () => {
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Edith', observations_append: 'this should never persist' }],
    })

    const edith = getCharactersForWorld(worldId).find((c) => c.name === 'Edith')!
    expect(edith.is_player).toBe(1)
    expect(edith.observations).toBeNull()
  })

  it('omitting observations_append leaves existing observations unchanged', async () => {
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Tom', observations_append: 'noticed something off' }],
    })
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Tom', current_attitude: 'wary' }],
    })

    const tom = getCharactersForWorld(worldId).find((c) => c.name === 'Tom')!
    expect(tom.observations).toBe(`noticed something off [t:${turnId}]`)
    expect(tom.current_attitude).toBe('wary')
  })

  it('upserts place by case-insensitive name; idempotent on repeat', async () => {
    await applyArchivistPatch(worldId, turnId, { places: [{ name: 'The Ship Inn', kind: 'tavern' }] })
    await applyArchivistPatch(worldId, turnId, {
      places: [{ name: 'the ship inn', description: 'Smoky front room.' }],
    })

    const places = getPlacesForWorld(worldId)
    const inn = places.find((p) => p.name === 'The Ship Inn')!
    expect(places.filter((p) => p.name.toLowerCase() === 'the ship inn')).toHaveLength(1)
    expect(inn.kind).toBe('tavern') // preserved
    expect(inn.description).toBe('Smoky front room.') // updated on second call
  })

  it('canonicalizes qualified and nested house place names', async () => {
    await applyArchivistPatch(worldId, turnId, {
      places: [{ name: '33rd Street house', description: "Andrew and Jordana's home." }],
    })
    await applyArchivistPatch(worldId, turnId, {
      places: [
        { name: '33rd Street house - kitchen', kind: 'room' },
        { name: '33rd Street house, Spokane', description: 'A home in Spokane.' },
      ],
    })

    const places = getPlacesForWorld(worldId)
    expect(places.filter((p) => p.name.startsWith('33rd Street house'))).toHaveLength(1)
    const house = places.find((p) => p.name === '33rd Street house')!
    expect(house.description).toBe('A home in Spokane.')
    expect(house.kind).toBe('room')
  })

  it('maps generic residential rooms to the current house instead of creating pseudo-places', async () => {
    await applyArchivistPatch(worldId, turnId, {
      scene: { action: 'open', title: 'At Home', place_name: '33rd Street house' },
    })
    await applyArchivistPatch(worldId, turnId, {
      places: [{ name: 'Kitchen' }],
      characters: [{ name: 'Jordana', current_place_name: 'Bedroom' }],
    })

    const places = getPlacesForWorld(worldId)
    const house = places.find((p) => p.name === '33rd Street house')!
    const jordana = getCharactersForWorld(worldId).find((c) => c.name === 'Jordana')!
    expect(places.some((p) => p.name === 'Kitchen')).toBe(false)
    expect(places.some((p) => p.name === 'Bedroom')).toBe(false)
    expect(jordana.current_place_id).toBe(house.id)
  })

  it('canonicalizes office and transit-flavored place variants', async () => {
    await applyArchivistPatch(worldId, turnId, {
      places: [
        { name: 'Covenant Security' },
        { name: 'House on Rosebury Ln' },
        { name: 'Spokane' },
      ],
    })
    await applyArchivistPatch(worldId, turnId, {
      places: [
        { name: 'Covenant Security office' },
        { name: 'Covenant Security third floor' },
        { name: 'His house on Rosebury Ln, Spokane' },
        { name: 'not yet at Covenant Security office' },
        { name: 'Spokane, Washington, USA' },
        { name: 'Spokane - En route to downtown' },
      ],
    })

    const places = getPlacesForWorld(worldId)
    expect(places.filter((p) => p.name.startsWith('Covenant Security'))).toHaveLength(1)
    expect(places.filter((p) => p.name.includes('Rosebury Ln'))).toHaveLength(1)
    expect(places.filter((p) => p.name.startsWith('Spokane'))).toHaveLength(1)
  })

  it("closes the active scene with a summary and turn pointer", async () => {
    const scene = getActiveSceneForWorld(worldId)!
    await applyArchivistPatch(worldId, turnId, {
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

  it("opens a new scene; auto-closes the prior active scene and advances the world cursor", async () => {
    const priorScene = getActiveSceneForWorld(worldId)!
    await applyArchivistPatch(worldId, turnId, {
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

  it('opening a scene also moves the player character to that place', async () => {
    await applyArchivistPatch(worldId, turnId, {
      scene: { action: 'open', title: 'Inside the Ship Inn', place_name: 'The Ship Inn' },
    })

    const shipInn = getPlacesForWorld(worldId).find((p) => p.name === 'The Ship Inn')!
    const player = getCharactersForWorld(worldId).find((c) => c.is_player === 1)!
    expect(player.current_place_id).toBe(shipInn.id)
  })

  it("'keep_open' is a no-op for scenes", async () => {
    const before = getScenesForWorld(worldId).map((s) => ({ id: s.id, status: s.status }))
    await applyArchivistPatch(worldId, turnId, { scene: { action: 'keep_open' } })
    expect(getScenesForWorld(worldId).map((s) => ({ id: s.id, status: s.status }))).toEqual(before)
  })

  it('updates active scene pacing context without changing scene identity', async () => {
    const before = getActiveSceneForWorld(worldId)!
    await applyArchivistPatch(worldId, turnId, {
      scene_context: {
        scene_mood: 'tense',
        pace: 'medium',
        focus: 'action',
      },
    })

    const after = getActiveSceneForWorld(worldId)!
    expect(after.id).toBe(before.id)
    expect(after.scene_mood).toBe('tense')
    expect(after.pace).toBe('medium')
    expect(after.focus).toBe('action')
  })

  it('resolves character current_place_name against places listed earlier in the same patch', async () => {
    await applyArchivistPatch(worldId, turnId, {
      places: [{ name: 'Lighthouse Cliff' }],
      characters: [{ name: 'Old Bran', current_place_name: 'Lighthouse Cliff' }],
    })
    const bran = getCharactersForWorld(worldId).find((c) => c.name === 'Old Bran')!
    const cliff = getPlacesForWorld(worldId).find((p) => p.name === 'Lighthouse Cliff')!
    expect(bran.current_place_id).toBe(cliff.id)
  })

  // v0.6.10 scene-transition invariant — modelled on the Call-In Case
  // (world 6, turns 389-403). The archivist relocates a cluster of NPCs to a
  // new place while dropping the protagonist's own location and the scene
  // action; deterministic code infers the move and advances player + cursor.
  it('infers a player + cursor move when a cluster of NPCs relocates and the player row is omitted', async () => {
    // Establish two NPCs present with the player at the harbour (scene 1 place).
    await applyArchivistPatch(worldId, turnId, {
      characters: [
        { name: 'Micha', description: 'A paramedic.', current_place_name: 'Mevagissey harbour' },
        { name: 'Karen', description: 'A charge nurse.', current_place_name: 'Mevagissey harbour' },
      ],
    })
    const harbour = getPlacesForWorld(worldId).find((p) => p.name === 'Mevagissey harbour')!
    const priorScene = getActiveSceneForWorld(worldId)!
    expect(priorScene.place_id).toBe(harbour.id)

    // Travel turn: the cast relocates to the hospital; the archivist drops the
    // player's location and omits the scene action (the Call-In failure shape).
    const travelTurn = insertTurn(
      worldId,
      'assistant',
      'The team pulls into Sacred Heart and hurries inside.',
      null,
    )
    await applyArchivistPatch(worldId, travelTurn.id, {
      characters: [
        { name: 'Micha', current_place_name: 'Sacred Heart Hospital' },
        { name: 'Karen', current_place_name: 'Sacred Heart Hospital' },
      ],
    })

    const hospital = getPlacesForWorld(worldId).find((p) => p.name === 'Sacred Heart Hospital')!
    const activeScene = getActiveSceneForWorld(worldId)!
    // Cursor advanced to a NEW scene at the hospital.
    expect(activeScene.id).not.toBe(priorScene.id)
    expect(activeScene.place_id).toBe(hospital.id)
    // Prior scene auto-closed at the travel turn.
    const closed = db
      .prepare('SELECT status, closed_at_turn FROM scenes WHERE id = ?')
      .get(priorScene.id) as { status: string; closed_at_turn: number }
    expect(closed.status).toBe('completed')
    expect(closed.closed_at_turn).toBe(travelTurn.id)
    // Protagonist dragged along to the cluster.
    const player = getCharactersForWorld(worldId).find((c) => c.is_player === 1)!
    expect(player.current_place_id).toBe(hospital.id)
  })

  it('does NOT fire when the patch moves the player away from the relocating NPC cluster (turn-403 shape)', async () => {
    // NPCs present with the player at the harbour.
    await applyArchivistPatch(worldId, turnId, {
      characters: [
        { name: 'Micha', description: 'A paramedic.', current_place_name: 'Mevagissey harbour' },
        { name: 'Karen', description: 'A charge nurse.', current_place_name: 'Mevagissey harbour' },
      ],
    })
    const priorScene = getActiveSceneForWorld(worldId)!
    const scenesBefore = getScenesForWorld(worldId).length

    // The NPCs relocate to the hospital, but the patch explicitly keeps the
    // protagonist at the harbour — the player is moving AWAY from the cluster,
    // so the direction guard must suppress the inference.
    const turn = insertTurn(
      worldId,
      'assistant',
      'Back at the harbour, you watch the ambulance leave for Sacred Heart.',
      null,
    )
    await applyArchivistPatch(worldId, turn.id, {
      characters: [
        { name: 'Micha', current_place_name: 'Sacred Heart Hospital' },
        { name: 'Karen', current_place_name: 'Sacred Heart Hospital' },
        { name: 'Edith', is_player: true, current_place_name: 'Mevagissey harbour' },
      ],
    })

    // No new scene, cursor unchanged.
    expect(getScenesForWorld(worldId).length).toBe(scenesBefore)
    expect(getWorldCursor(worldId).current_scene_id).toBe(priorScene.id)
  })

  it('inserts a new NPC with active_goal and current_attitude', async () => {
    await applyArchivistPatch(worldId, turnId, {
      characters: [
        {
          name: 'Innkeeper',
          description: 'Round-faced, wary.',
          active_goal: 'sell the player a room before dusk',
          current_attitude: 'polite but probing',
        },
      ],
    })
    const ink = getCharactersForWorld(worldId).find((c) => c.name === 'Innkeeper')!
    expect(ink.active_goal).toBe('sell the player a room before dusk')
    expect(ink.current_attitude).toBe('polite but probing')
  })

  it('insert defaults: omitted goal/attitude → NULL on a new row', async () => {
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Silent Watcher', description: 'A figure on the cliff path.' }],
    })
    const watcher = getCharactersForWorld(worldId).find((c) => c.name === 'Silent Watcher')!
    expect(watcher.active_goal).toBeNull()
    expect(watcher.current_attitude).toBeNull()
  })

  it('updates active_goal on an existing NPC; omitted means unchanged', async () => {
    await applyArchivistPatch(worldId, turnId, {
      characters: [
        { name: 'Tom', description: 'Harbourmaster.', active_goal: 'avoid the constable' },
      ],
    })
    // Second patch omits active_goal entirely — must NOT clobber.
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Tom', current_attitude: 'gruff' }],
    })
    const tom = getCharactersForWorld(worldId).find((c) => c.name === 'Tom')!
    expect(tom.active_goal).toBe('avoid the constable')
    expect(tom.current_attitude).toBe('gruff')
  })

  it('explicit null clears active_goal (satisfied/abandoned)', async () => {
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Tom', active_goal: 'find the missing skipper' }],
    })
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Tom', active_goal: null }],
    })
    const tom = getCharactersForWorld(worldId).find((c) => c.name === 'Tom')!
    expect(tom.active_goal).toBeNull()
  })

  it('changing active_goal replaces the prior value (not appended)', async () => {
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Tom', active_goal: 'sell the catch' }],
    })
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Tom', active_goal: 'warn the player about the storm' }],
    })
    const tom = getCharactersForWorld(worldId).find((c) => c.name === 'Tom')!
    expect(tom.active_goal).toBe('warn the player about the storm')
  })

  it('updates current_attitude; omitted means unchanged; null clears', async () => {
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Tom', current_attitude: 'cautious, weighing his words' }],
    })
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Tom', description: 'A harbourmaster, late 50s.' }], // attitude omitted
    })
    let tom = getCharactersForWorld(worldId).find((c) => c.name === 'Tom')!
    expect(tom.current_attitude).toBe('cautious, weighing his words')
    expect(tom.description).toBe('A harbourmaster, late 50s.')

    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Tom', current_attitude: null }],
    })
    tom = getCharactersForWorld(worldId).find((c) => c.name === 'Tom')!
    expect(tom.current_attitude).toBeNull()
  })

  it('goal/attitude updates do not disturb memorable_facts', async () => {
    await applyArchivistPatch(worldId, turnId, {
      characters: [
        { name: 'Tom', memorable_facts_append: 'gave the player a silver locket' },
      ],
    })
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Tom', active_goal: 'recover the locket' }],
    })
    const tom = getCharactersForWorld(worldId).find((c) => c.name === 'Tom')!
    expect(tom.memorable_facts).toBe(`gave the player a silver locket [t:${turnId}]`)
    expect(tom.active_goal).toBe('recover the locket')
  })

  // v0.6.6 — player canon channel
  it('player_notes_append on the player adds a single line', async () => {
    const player = getCharactersForWorld(worldId).find((c) => c.is_player === 1)!
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: player.name, player_notes_append: 'Drives a Subaru Outback' }],
    })
    const after = getCharactersForWorld(worldId).find((c) => c.is_player === 1)!
    expect(after.player_notes).toBe('Drives a Subaru Outback')
  })

  it('player_notes_append accumulates lines across calls', async () => {
    const player = getCharactersForWorld(worldId).find((c) => c.is_player === 1)!
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: player.name, player_notes_append: 'Drives a Subaru Outback' }],
    })
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: player.name, player_notes_append: 'Has a sister Maeve in Boston' }],
    })
    const after = getCharactersForWorld(worldId).find((c) => c.is_player === 1)!
    expect(after.player_notes).toBe('Drives a Subaru Outback\nHas a sister Maeve in Boston')
  })

  it('player_notes_append on a new character creates the row and writes the note', async () => {
    await applyArchivistPatch(worldId, turnId, {
      characters: [
        {
          name: 'Maeve',
          description: 'Player\'s sister.',
          player_notes_append: 'Lives in Boston',
        },
      ],
    })
    const maeve = getCharactersForWorld(worldId).find((c) => c.name === 'Maeve')!
    expect(maeve.player_notes).toBe('Lives in Boston')
    expect(maeve.description).toBe("Player's sister.")
  })

  it('place player_notes_append accumulates lines', async () => {
    await applyArchivistPatch(worldId, turnId, {
      places: [{ name: 'Mevagissey harbour', player_notes_append: 'Where my grandfather worked' }],
    })
    await applyArchivistPatch(worldId, turnId, {
      places: [{ name: 'Mevagissey harbour', player_notes_append: 'Mooring 14 is the family slip' }],
    })
    const place = getPlacesForWorld(worldId).find((p) =>
      /harbour/i.test(p.name),
    )!
    expect(place.player_notes).toBe(
      'Where my grandfather worked\nMooring 14 is the family slip',
    )
  })

  it('aliases merges two existing NPC rows whose names do not overlap', async () => {
    await applyArchivistPatch(worldId, turnId, {
      characters: [
        { name: 'Bob', description: 'A drinker at the back of the pub.' },
        { name: 'Robert', description: 'Former lighthouse keeper.' },
      ],
    })
    expect(getCharactersForWorld(worldId).filter((c) => /^(?:bob|robert)$/i.test(c.name))).toHaveLength(2)

    await applyArchivistPatch(worldId, turnId, {
      characters: [
        { name: 'Robert', aliases: ['Bob'], player_notes_append: 'Bob is short for Robert' },
      ],
    })

    const remaining = getCharactersForWorld(worldId).filter((c) =>
      /^(?:bob|robert)$/i.test(c.name),
    )
    expect(remaining).toHaveLength(1)
    expect(remaining[0].name).toBe('Robert')
    // mergeCharacters' chooseLonger collapses the two descriptions into the
    // longer one of the pair; either prior value is acceptable as long as no
    // data was dropped.
    expect(remaining[0].description?.length ?? 0).toBeGreaterThan(0)
    expect(remaining[0].player_notes).toBe('Bob is short for Robert')
  })

  it('aliases is a no-op when the named alias does not exist', async () => {
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Robert', description: 'Former lighthouse keeper.' }],
    })
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Robert', aliases: ['Bob'] }],
    })
    const remaining = getCharactersForWorld(worldId).filter((c) => c.name === 'Robert')
    expect(remaining).toHaveLength(1)
  })

  it('aliases merge preserves fresh scalar fields from the more recently updated row', async () => {
    // Create "Jordana" first, with stale scalar state.
    await applyArchivistPatch(worldId, turnId, {
      characters: [
        {
          name: 'Jordana',
          description: 'A clerk at the records office.',
          active_goal: 'finish the morning ledger',
          current_attitude: 'curt',
        },
      ],
    })
    // Force a measurable updated_at gap so the freshness preference is
    // unambiguous — SQLite's datetime('now') is per-second granularity, so a
    // sub-second second patch would otherwise tie.
    await new Promise((resolve) => setTimeout(resolve, 1100))
    // Then "Jordana Osborne" with the *current* state.
    await applyArchivistPatch(worldId, turnId, {
      characters: [
        {
          name: 'Jordana Osborne',
          description: 'Clerk turned investigator, deep in a wartime archive.',
          active_goal: 'identify the unmarked fragment',
          current_attitude: 'guarded but engaged',
        },
      ],
    })

    // Player merges them via alias.
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Jordana Osborne', aliases: ['Jordana'] }],
    })

    const remaining = getCharactersForWorld(worldId).filter((c) =>
      /jordana/i.test(c.name),
    )
    expect(remaining).toHaveLength(1)
    expect(remaining[0].name).toBe('Jordana Osborne')
    // Fresh state from the newer row survives even though "Jordana" (the
    // older row by id) was the merge target. Pre-fix this returned the stale
    // 'finish the morning ledger' / 'curt' pair.
    expect(remaining[0].active_goal).toBe('identify the unmarked fragment')
    expect(remaining[0].current_attitude).toBe('guarded but engaged')
  })

  it('alias merge uses the patch-supplied name as the canonical even when target was older', async () => {
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Jordana', description: 'A clerk.' }],
    })
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Jordana Osborne', description: 'A clerk turned investigator.' }],
    })
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Jordana Osborne', aliases: ['Jordana'] }],
    })
    const remaining = getCharactersForWorld(worldId).filter((c) => /jordana/i.test(c.name))
    expect(remaining).toHaveLength(1)
    expect(remaining[0].name).toBe('Jordana Osborne')
  })

  it('aliases will not merge across the player/NPC boundary', async () => {
    const player = getCharactersForWorld(worldId).find((c) => c.is_player === 1)!
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: 'Edith Stranger', description: 'A drifter said to share my name.' }],
    })
    await applyArchivistPatch(worldId, turnId, {
      characters: [{ name: player.name, aliases: ['Edith Stranger'] }],
    })
    const everyone = getCharactersForWorld(worldId)
    expect(everyone.filter((c) => c.is_player === 1)).toHaveLength(1)
    expect(everyone.find((c) => c.name === 'Edith Stranger')).toBeDefined()
  })

  it('persists aliases on the canonical row and resolves new descriptors via them', async () => {
    // First turn: archivist creates an unnamed figure.
    await applyArchivistPatch(worldId, turnId, {
      characters: [
        {
          name: 'The Man at the Gyro Van',
          description: 'A short figure with pale grey eyes, behind the service window.',
        },
      ],
    })
    let everyone = getCharactersForWorld(worldId).filter((c) => c.is_player === 0)
    expect(everyone).toHaveLength(1)

    // Second turn: archivist refers to the same figure with a new descriptor
    // and lists the new descriptor as an alias on the existing row. Expect
    // the canonical row's aliases column to gain the new descriptor and the
    // total character count to NOT increase.
    await applyArchivistPatch(worldId, turnId, {
      characters: [
        {
          name: 'The Man at the Gyro Van',
          aliases: ['The Man in the Canvas Vest'],
          memorable_facts_append: 'wore a canvas vest with deep pockets',
        },
      ],
    })
    everyone = getCharactersForWorld(worldId).filter((c) => c.is_player === 0)
    expect(everyone).toHaveLength(1)
    const stranger = everyone[0]
    expect(stranger.aliases?.split('\n')).toContain('The Man in the Canvas Vest')

    // Third turn: archivist references the figure by the alias only. Expect
    // resolveCharacter() to find the canonical row via its aliases list and
    // apply the update there — no new row created.
    await applyArchivistPatch(worldId, turnId, {
      characters: [
        {
          name: 'The Man in the Canvas Vest',
          memorable_facts_append: 'spoke in an unrecognizable rolling tongue',
        },
      ],
    })
    everyone = getCharactersForWorld(worldId).filter((c) => c.is_player === 0)
    expect(everyone).toHaveLength(1)
    expect(everyone[0].id).toBe(stranger.id)
    expect(everyone[0].memorable_facts).toContain('rolling tongue')
  })
})

describe('extractDeterministicPatch', () => {
  it('extracts an obvious accepted destination move without an LLM', () => {
    const { worldId } = seedWorld(`Deterministic-${Math.random()}`)
    const prior = getNarratorWorldState(worldId)

    const patch = extractDeterministicPatch(
      prior,
      'I walk to the old chapel.',
      'You walk to the old chapel. The harbour drops away behind you.',
    )

    expect(patch).toEqual({
      places: [{ name: 'Old chapel' }],
      characters: [{ name: 'Edith', is_player: true, current_place_name: 'Old chapel' }],
      scene: { action: 'open', title: 'At Old chapel', place_name: 'Old chapel' },
    })
  })

  it('accepts natural destination variants like a campus arrival', () => {
    const { worldId } = seedWorld(`Deterministic-${Math.random()}`)
    const prior = getNarratorWorldState(worldId)

    const patch = extractDeterministicPatch(
      prior,
      'I get into my Kia Sportage and drive to Whitworth university',
      'You settle behind the wheel and take the quiet roads north. Seventeen minutes later the campus edges come into view, Whitworth buildings rising against the Spokane morning. You pull into a spot near the main entrance and kill the engine.',
    )

    expect(patch).toEqual({
      places: [{ name: 'Whitworth university' }],
      characters: [{ name: 'Edith', is_player: true, current_place_name: 'Whitworth university' }],
      scene: {
        action: 'open',
        title: 'At Whitworth university',
        place_name: 'Whitworth university',
      },
    })
  })

  it('does not extract a destination the narrator did not confirm', () => {
    const { worldId } = seedWorld(`Deterministic-${Math.random()}`)
    const prior = getNarratorWorldState(worldId)

    expect(
      extractDeterministicPatch(
        prior,
        'I walk to the old chapel.',
        'You start toward it, but the floodwater blocks the road.',
      ),
    ).toBeNull()
  })
})

describe('sanitizeArchivistPatch', () => {
  it('drops unsupported player location moves from ordinary in-place bar turns', async () => {
    const { worldId } = seedWorld(`Sanitize-${Math.random()}`)
    const setupTurn = insertTurn(worldId, 'assistant', 'You find a stool at Tapped.', null)
    await applyArchivistPatch(worldId, setupTurn.id, {
      places: [{ name: '33rd Street house', description: "Edith's home." }],
      scene: { action: 'open', title: 'At Tapped', place_name: 'Tapped' },
      characters: [{ name: 'Edith', is_player: true, current_place_name: 'Tapped' }],
    })
    const prior = getNarratorWorldState(worldId)

    const patch: ArchivistPatch = {
      scene: { action: 'open', title: 'At Home', place_name: '33rd Street house' },
      characters: [{ name: 'Edith', is_player: true, current_place_name: '33rd Street house' }],
      places: [{ name: '33rd Street house' }],
    }

    expect(
      sanitizeArchivistPatch(
        prior,
        [
          { role: 'user', content: 'I down my glass and ask Jenna for another' },
          {
            role: 'assistant',
            content:
              'You drain the glass and set it down in front of Jenna. "Another," you say. She nods and reaches for the Tito\'s again.',
          },
        ],
        patch,
      ),
    ).toEqual({ places: [{ name: '33rd Street house' }] })
  })

  it('keeps narrator-supported scene moves', async () => {
    const { worldId } = seedWorld(`Sanitize-${Math.random()}`)
    const setupTurn = insertTurn(worldId, 'assistant', 'You find a stool at Tapped.', null)
    await applyArchivistPatch(worldId, setupTurn.id, {
      scene: { action: 'open', title: 'At Tapped', place_name: 'Tapped' },
      characters: [{ name: 'Edith', is_player: true, current_place_name: 'Tapped' }],
    })
    const prior = getNarratorWorldState(worldId)

    const patch: ArchivistPatch = {
      scene: { action: 'open', title: 'Behind the Bar', place_name: 'Back room' },
      characters: [{ name: 'Edith', is_player: true, current_place_name: 'Back room' }],
    }

    expect(
      sanitizeArchivistPatch(
        prior,
        [
          { role: 'user', content: 'I follow Jenna.' },
          {
            role: 'assistant',
            content:
              'Jenna lifts the counter flap and leads you through the staff door into the back room.',
          },
        ],
        patch,
      ),
    ).toEqual(patch)
  })

  it('does not treat thinking about going home as physical travel', async () => {
    const { worldId } = seedWorld(`Sanitize-${Math.random()}`)
    const setupTurn = insertTurn(worldId, 'assistant', 'You find a stool at Tapped.', null)
    await applyArchivistPatch(worldId, setupTurn.id, {
      places: [{ name: '33rd Street house', description: "Edith's home." }],
      scene: { action: 'open', title: 'At Tapped', place_name: 'Tapped' },
      characters: [{ name: 'Edith', is_player: true, current_place_name: 'Tapped' }],
    })
    const prior = getNarratorWorldState(worldId)

    const patch: ArchivistPatch = {
      scene: { action: 'open', title: 'At Home', place_name: '33rd Street house' },
      characters: [{ name: 'Edith', is_player: true, current_place_name: '33rd Street house' }],
    }

    expect(
      sanitizeArchivistPatch(
        prior,
        [
          { role: 'user', content: 'I think about going home.' },
          {
            role: 'assistant',
            content:
              'You think about going home, but the thought stays in your head while the bar noise rolls around you.',
          },
        ],
        patch,
      ),
    ).toEqual({})
  })
})

describe('applyArchivistPatch player-move scene invariant (A1)', () => {
  it('opens a scene at the player new place when the patch moves the player without a scene action', async () => {
    const world = createWorld({
      name: 'Player Move',
      premise: 'A heist in Prague.',
      initialState: { time: 'Night', location: 'The vault', identity: 'A thief.', playerName: 'Reuben' },
    })
    const t1 = insertTurn(world.id, 'assistant', 'You stand in the vault.', null)
    await applyArchivistPatch(world.id, t1.id, {
      characters: [{ name: 'Abby', description: 'The driver.', current_place_name: 'The vault' }],
    })
    const before = getNarratorWorldState(world.id)
    const vaultSceneId = before.currentScene?.id
    const t2 = insertTurn(world.id, 'assistant', 'You step inside the safe house.', null)
    await applyArchivistPatch(world.id, t2.id, {
      characters: [{ name: 'Reuben', is_player: true, current_place_name: 'Safe house' }],
    })
    const after = getNarratorWorldState(world.id)
    expect(after.currentScene?.id).not.toBe(vaultSceneId)
    expect(after.currentPlace?.name).toBe('Safe house')
  })

  it('does NOT auto-open when the player moves while the patch restates an NPC at the old scene place (backward-flip guard)', async () => {
    const world = createWorld({
      name: 'Flip Guard',
      premise: 'A heist in Prague.',
      initialState: { time: 'Night', location: 'The hospital', identity: 'A medic.', playerName: 'Andrew' },
    })
    const t1 = insertTurn(world.id, 'assistant', 'You stand in the hospital with Micha.', null)
    await applyArchivistPatch(world.id, t1.id, {
      characters: [{ name: 'Micha', description: 'A colleague.', current_place_name: 'The hospital' }],
    })
    const before = getNarratorWorldState(world.id)
    const hospitalSceneId = before.currentScene?.id
    // Backward "home flip": player sent home while Micha is explicitly restated at the hospital.
    const t2 = insertTurn(world.id, 'assistant', 'The narrator wrongly snaps you home.', null)
    await applyArchivistPatch(world.id, t2.id, {
      characters: [
        { name: 'Andrew', is_player: true, current_place_name: 'Home' },
        { name: 'Micha', current_place_name: 'The hospital' },
      ],
    })
    const after = getNarratorWorldState(world.id)
    // The invariant must NOT advance the cursor — an NPC pinned at the old scene
    // place is the backward-flip signature; defer to v0.6.10 logic (which holds).
    expect(after.currentScene?.id).toBe(hospitalSceneId)
  })
})

describe('applyArchivistPatch transit normalization (A1)', () => {
  it('upserts a transit pseudo-place under its destination name', async () => {
    const world = createWorld({
      name: 'Transit Norm',
      premise: 'A heist in Prague.',
      initialState: { time: 'Night', location: 'The vault', identity: 'A thief.', playerName: 'Reuben' },
    })
    const turn = insertTurn(world.id, 'assistant', 'The van pulls away toward the safe house.', null)
    await applyArchivistPatch(world.id, turn.id, {
      places: [{ name: 'En route to safe house - Prague' }],
      characters: [{ name: 'Reuben', is_player: true, current_place_name: 'En route to safe house - Prague' }],
      scene: { action: 'open', title: 'In the van', place_name: 'En route to safe house - Prague' },
    })
    const names = getPlacesForWorld(world.id).map((p) => p.name)
    expect(names).toContain('safe house - Prague')
    expect(names).not.toContain('En route to safe house - Prague')
  })
})

describe('normalizeTransitPlaceName', () => {
  it('strips a leading "en route to" prefix to the destination', () => {
    expect(normalizeTransitPlaceName('En route to safe house')).toBe('safe house')
  })
  it('keeps a city qualifier on the destination', () => {
    expect(normalizeTransitPlaceName('En route to safe house - Prague')).toBe('safe house - Prague')
  })
  it('resolves "X - en route to Y" to Y', () => {
    expect(normalizeTransitPlaceName('Prague flat - en route to the docks')).toBe('the docks')
  })
  it('strips other transit framings', () => {
    expect(normalizeTransitPlaceName('Heading back to the office')).toBe('the office')
    expect(normalizeTransitPlaceName('On the way to the bridge')).toBe('the bridge')
    expect(normalizeTransitPlaceName('Not yet at the vault')).toBe('the vault')
    expect(normalizeTransitPlaceName('Heading to the office')).toBe('the office')
  })
  it('leaves a real place name untouched', () => {
    expect(normalizeTransitPlaceName('The basement vault of the Violet Exchange')).toBe('The basement vault of the Violet Exchange')
  })
})
