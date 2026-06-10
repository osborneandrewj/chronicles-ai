import { describe, expect, it } from 'vitest'

import { db } from '@/lib/db'
import { createWorld as createOpenWorld } from '@/lib/worlds'
import { SqliteCharacterRepository } from '@/infrastructure/persistence/sqlite/character-repository.sqlite'
import { SqlitePlaceConnectionRepository } from '@/infrastructure/persistence/sqlite/place-connection-repository.sqlite'
import { SqlitePlaceRepository } from '@/infrastructure/persistence/sqlite/place-repository.sqlite'
import { SqliteRelationshipRepository } from '@/infrastructure/persistence/sqlite/relationship-repository.sqlite'
import { SqliteSceneRepository } from '@/infrastructure/persistence/sqlite/scene-repository.sqlite'
import { SqliteWorldRepository } from '@/infrastructure/persistence/sqlite/world-repository.sqlite'

// SQLite-adapter tests for the bounded-world write surface (starship P1). They
// run against the shared in-memory db singleton (DATABASE_PATH=:memory: in the
// vitest config) with all migrations applied, scoping state per test by creating
// a fresh bounded world each time.

const worlds = new SqliteWorldRepository()
const places = new SqlitePlaceRepository()
const characters = new SqliteCharacterRepository()
const connections = new SqlitePlaceConnectionRepository()
const relationships = new SqliteRelationshipRepository()
const scenes = new SqliteSceneRepository()

function tableCount(table: string, worldId: number): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE world_id = ?`)
    .get(worldId) as { n: number }
  return row.n
}

async function createWorld(name: string): Promise<number> {
  const { id } = await worlds.createBounded({
    name,
    premise: 'A small scout ship adrift.',
    initialStateJson: JSON.stringify({ time: 'Morning' }),
    templateId: 'scout',
  })
  return id
}

describe('SqliteWorldRepository.createBounded', () => {
  it("writes spatial_mode='bounded' and the template id", async () => {
    const id = await createWorld(`bounded-${Math.random()}`)
    const row = db
      .prepare('SELECT spatial_mode, template_id FROM worlds WHERE id = ?')
      .get(id) as { spatial_mode: string; template_id: string | null }
    expect(row.spatial_mode).toBe('bounded')
    expect(row.template_id).toBe('scout')
  })

  it('does NOT auto-seed a place, character, or scene', async () => {
    const id = await createWorld(`bare-${Math.random()}`)
    expect(tableCount('places', id)).toBe(0)
    expect(tableCount('characters', id)).toBe(0)
    expect(tableCount('scenes', id)).toBe(0)
  })
})

describe('SqliteWorldRepository.simulationsForHub', () => {
  it('returns only the hub\'s subworlds, newest-first', async () => {
    const hub = await createWorld(`hub-${Math.random()}`)
    await worlds.setLayer(hub, 'hub', null)
    const otherHub = await createWorld(`other-${Math.random()}`)
    await worlds.setLayer(otherHub, 'hub', null)

    const sim1 = await createWorld(`sim1-${Math.random()}`)
    await worlds.setLayer(sim1, 'subworld', hub)
    const sim2 = await createWorld(`sim2-${Math.random()}`)
    await worlds.setLayer(sim2, 'subworld', hub)
    const otherSim = await createWorld(`othersim-${Math.random()}`)
    await worlds.setLayer(otherSim, 'subworld', otherHub)

    const sims = await worlds.simulationsForHub(hub)
    expect(sims.map((s) => s.id).sort()).toEqual([sim1, sim2].sort())
    // Newest-first ordering (sim2 created after sim1).
    expect(sims[0].id).toBe(sim2)
    // world_layer is projected for the home-list visibility rule.
    expect(sims.every((s) => s.world_layer === 'subworld')).toBe(true)
  })
})

describe('SqlitePlaceRepository.add', () => {
  it('round-trips a room carrying deck + layout_hint', async () => {
    const worldId = await createWorld(`places-${Math.random()}`)
    const { id } = await places.add({
      world_id: worldId,
      name: 'Bridge',
      description: 'The command deck.',
      kind: 'room',
      deck: 'A',
      layout_hint: JSON.stringify({ x: 0, y: 0 }),
    })
    const byId = await places.byId(id)
    expect(byId?.name).toBe('Bridge')
    expect(byId?.deck).toBe('A')
    expect(byId?.layout_hint).toBe(JSON.stringify({ x: 0, y: 0 }))
    // A6: bounded rooms are sealed fictional interiors — never geocoded.
    expect(byId?.geo_status).toBe('unavailable')

    const forWorld = await places.forWorld(worldId)
    expect(forWorld).toHaveLength(1)
    expect(forWorld[0]?.deck).toBe('A')
    expect(forWorld[0]?.layout_hint).toBe(JSON.stringify({ x: 0, y: 0 }))
  })
})

describe('SqliteCharacterRepository.add', () => {
  it('round-trips crew with role (current_focus), goal, and daily_loop', async () => {
    const worldId = await createWorld(`chars-${Math.random()}`)
    const { id: placeId } = await places.add({
      world_id: worldId,
      name: 'Engine Room',
      description: 'Hot and loud.',
      kind: 'room',
      deck: 'B',
      layout_hint: null,
    })
    const loop = JSON.stringify({ Morning: { activity: 'tune drives', place: 'Engine Room' } })
    const { id } = await characters.add({
      world_id: worldId,
      name: 'Vega',
      description: 'Chief engineer.',
      is_player: 0,
      current_place_id: placeId,
      role: 'engineer',
      active_goal: 'Keep the drive stable.',
      daily_loop: loop,
    })

    const crew = await characters.forWorld(worldId)
    expect(crew).toHaveLength(1)
    const vega = crew[0]
    expect(vega?.id).toBe(id)
    expect(vega?.is_player).toBe(0)
    expect(vega?.current_place_id).toBe(placeId)
    expect(vega?.current_focus).toBe('engineer')
    expect(vega?.active_goal).toBe('Keep the drive stable.')
    expect(vega?.daily_loop).toBe(loop)

    const inPlace = await characters.inPlace(worldId, placeId)
    expect(inPlace.map((c) => c.id)).toContain(id)
  })
})

describe('SqliteCharacterRepository.setPlace', () => {
  it('round-trips current_place_id (move, then clear)', async () => {
    const worldId = await createWorld(`setplace-${Math.random()}`)
    const { id: bridge } = await places.add({
      world_id: worldId,
      name: 'Bridge',
      description: null,
      kind: 'room',
      deck: 'A',
      layout_hint: null,
    })
    const { id: charId } = await characters.add({
      world_id: worldId,
      name: 'Pilot',
      description: null,
      is_player: 0,
      current_place_id: null,
      role: 'pilot',
      active_goal: null,
      daily_loop: null,
    })

    await characters.setPlace(charId, bridge)
    let crew = await characters.forWorld(worldId)
    expect(crew[0]?.current_place_id).toBe(bridge)

    await characters.setPlace(charId, null)
    crew = await characters.forWorld(worldId)
    expect(crew[0]?.current_place_id).toBeNull()
  })
})

describe('SqliteWorldRepository.setWorldTime', () => {
  it('updates world_time without touching the scene cursor', async () => {
    const worldId = await createWorld(`worldtime-${Math.random()}`)
    await worlds.setWorldTime(worldId, 'Day 6 — night')
    const cursor = await worlds.cursor(worldId)
    expect(cursor.world_time).toBe('Day 6 — night')
    expect(cursor.current_scene_id).toBeNull()
  })
})

describe('SqliteWorldRepository.setShipClockMinutes', () => {
  it('round-trips ship_clock_minutes via getWorld', async () => {
    const worldId = await createWorld(`shipclock-${Math.random()}`)
    let world = await worlds.getWorld(worldId)
    expect(world?.ship_clock_minutes).toBeNull()

    await worlds.setShipClockMinutes(worldId, 3990)
    world = await worlds.getWorld(worldId)
    expect(world?.ship_clock_minutes).toBe(3990)
  })

  it('leaves an open world ship_clock_minutes null (byte-green)', async () => {
    const open = createOpenWorld({
      name: `open-${Math.random()}`,
      premise: 'A quiet village.',
      initialState: {
        time: 'Late afternoon',
        location: 'The harbour',
        identity: 'A returning letter-writer.',
      },
    })
    const world = await worlds.getWorld(open.id)
    expect(world?.spatial_mode).toBe('open')
    expect(world?.ship_clock_minutes).toBeNull()
  })
})

describe('SqliteSceneRepository.add', () => {
  it('inserts a scene readable as the active scene for the world', async () => {
    const worldId = await createWorld(`scene-${Math.random()}`)
    const { id: bridge } = await places.add({
      world_id: worldId,
      name: 'Bridge',
      description: 'The command deck.',
      kind: 'room',
      deck: 'A',
      layout_hint: null,
    })

    const { id } = await scenes.add({
      world_id: worldId,
      place_id: bridge,
      title: 'Scene 1',
      scene_number: 1,
      status: 'active',
    })

    const active = await scenes.activeForWorld(worldId)
    expect(active?.id).toBe(id)
    expect(active?.place_id).toBe(bridge)
    expect(active?.title).toBe('Scene 1')
    expect(active?.scene_number).toBe(1)
    expect(active?.status).toBe('active')

    const forWorld = await scenes.forWorld(worldId)
    expect(forWorld.map((s) => s.id)).toContain(id)
  })
})

describe('SqliteWorldRepository.setCursor', () => {
  it('sets current_scene_id without touching world_time', async () => {
    const worldId = await createWorld(`cursor-${Math.random()}`)
    await worlds.setWorldTime(worldId, 'Day 3 — midday')
    const { id: bridge } = await places.add({
      world_id: worldId,
      name: 'Bridge',
      description: null,
      kind: 'room',
      deck: 'A',
      layout_hint: null,
    })
    const { id: sceneId } = await scenes.add({
      world_id: worldId,
      place_id: bridge,
      title: 'Scene 1',
      scene_number: 1,
      status: 'active',
    })

    await worlds.setCursor(worldId, sceneId)

    const cursor = await worlds.cursor(worldId)
    expect(cursor.current_scene_id).toBe(sceneId)
    expect(cursor.world_time).toBe('Day 3 — midday')
  })
})

describe('SqlitePlaceConnectionRepository', () => {
  it('adds edges and reads them back for the world', async () => {
    const worldId = await createWorld(`conn-${Math.random()}`)
    const { id: a } = await places.add({
      world_id: worldId,
      name: 'Bridge',
      description: null,
      kind: 'room',
      deck: 'A',
      layout_hint: null,
    })
    const { id: b } = await places.add({
      world_id: worldId,
      name: 'Corridor',
      description: null,
      kind: 'room',
      deck: 'A',
      layout_hint: null,
    })

    await connections.add([
      { world_id: worldId, from_place_id: a, to_place_id: b, kind: 'corridor', bidirectional: 1 },
    ])

    const edges = await connections.forWorld(worldId)
    expect(edges).toHaveLength(1)
    expect(edges[0]?.from_place_id).toBe(a)
    expect(edges[0]?.to_place_id).toBe(b)
    expect(edges[0]?.kind).toBe('corridor')
    expect(edges[0]?.bidirectional).toBe(1)
    expect(edges[0]?.created_at).toBeTruthy()
  })
})

describe('SqliteRelationshipRepository', () => {
  it('upserts, adjusts valence, and reads back for the world', async () => {
    const worldId = await createWorld(`rel-${Math.random()}`)
    const { id: cap } = await characters.add({
      world_id: worldId,
      name: 'Captain',
      description: null,
      is_player: 0,
      current_place_id: null,
      role: 'captain',
      active_goal: null,
      daily_loop: null,
    })
    const { id: eng } = await characters.add({
      world_id: worldId,
      name: 'Engineer',
      description: null,
      is_player: 0,
      current_place_id: null,
      role: 'engineer',
      active_goal: null,
      daily_loop: null,
    })

    await relationships.upsert([
      {
        world_id: worldId,
        from_character_id: cap,
        to_character_id: eng,
        kind: 'superior',
        valence: 0.2,
        note: 'trusts',
      },
    ])

    let edges = await relationships.forWorld(worldId)
    expect(edges).toHaveLength(1)
    expect(edges[0]?.kind).toBe('superior')
    expect(edges[0]?.valence).toBeCloseTo(0.2)

    // upsert again on the same (from,to) replaces kind/note + sets valence
    await relationships.upsert([
      {
        world_id: worldId,
        from_character_id: cap,
        to_character_id: eng,
        kind: 'rival',
        valence: -0.1,
        note: 'soured',
      },
    ])
    edges = await relationships.forWorld(worldId)
    expect(edges).toHaveLength(1)
    expect(edges[0]?.kind).toBe('rival')
    expect(edges[0]?.valence).toBeCloseTo(-0.1)

    // adjustValence applies a signed delta to the existing edge
    await relationships.adjustValence(edges[0]!.id, 0.5)
    edges = await relationships.forWorld(worldId)
    expect(edges[0]?.valence).toBeCloseTo(0.4)
  })
})
