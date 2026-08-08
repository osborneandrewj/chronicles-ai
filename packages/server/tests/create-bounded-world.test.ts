import { describe, expect, it } from 'vitest'

import {
  createBoundedWorld,
  type CreateBoundedWorldDeps,
} from '@/application/use-cases/create-bounded-world'
import type { Character, CharacterRelationship, Place, Scene } from '@/domain/entities'
import type {
  Clock,
  WorldArchetypeProvider,
  WorldArchetype,
} from '@/domain/ports'
import { StubEnsembleGenerator } from '@/infrastructure/world-gen/stub-crew-generator'
import { StubDramaPort } from '@/infrastructure/world-gen/stub-drama-port'

// Unit test for CreateStarshipWorld (starship P4a). Pure orchestration exercised
// with STATEFUL in-memory fake ports (so reads reflect writes) plus the real
// deterministic stubs (StubEnsembleGenerator / StubDramaPort — no spend) for the LLM
// seams. Asserts the seam seeds a bounded world, runs the sim with the ticks it
// is given, drops exactly one player (is_player=1) on the Bridge (rooms[0]),
// opens exactly one active scene there, and points the world cursor at it.

// A small connected template whose first room is the Bridge (mirrors the scout:
// placeIds[0] is the entry room). bridge ── mess ── quarters.
const TEMPLATE: WorldArchetype = {
  id: 'test-scout',
  name: 'Test Scout',
  isHub: true,
  simulationRoomKey: 'mess',
  entryLocationKey: 'bridge',
  initialSceneTitle: 'Arrival',
  defaultCharacterLabel: 'Newcomer',
  playerIntroTemplate: 'just come aboard',
  rooms: [
    { key: 'bridge', name: 'Bridge', description: 'cmd', deck: 'A', layoutHint: null },
    { key: 'mess', name: 'Mess', description: 'galley', deck: 'A', layoutHint: null },
    { key: 'quarters', name: 'Quarters', description: 'berths', deck: 'B', layoutHint: null },
  ],
  edges: [
    { from: 'bridge', to: 'mess', kind: 'corridor', bidirectional: true },
    { from: 'mess', to: 'quarters', kind: 'corridor', bidirectional: true },
  ],
  crew: [
    { role: 'captain', homeRoomKey: 'bridge', description: 'commands' },
    { role: 'cook', homeRoomKey: 'mess', description: 'feeds the crew' },
  ],
}

type Store = {
  characters: Array<Character & { daily_loop: string | null }>
  places: Place[]
  scenes: Scene[]
  relationships: CharacterRelationship[]
  connections: Array<{
    id: number
    world_id: number
    from_place_id: number
    to_place_id: number
    kind: string | null
    bidirectional: number
    created_at: string | null
  }>
  cursor: { current_scene_id: number | null }
  worldTime: string | null
  simTicks: number | null
  shipClockMinutes: number | null
}

function makeDeps(): { deps: CreateBoundedWorldDeps; store: Store } {
  const store: Store = {
    characters: [],
    places: [],
    scenes: [],
    relationships: [],
    connections: [],
    cursor: { current_scene_id: null },
    worldTime: null,
    simTicks: null,
    shipClockMinutes: null,
  }
  let nextPlaceId = 100
  let nextCharacterId = 200
  let nextSceneId = 300
  let nextRelId = 400
  let nextConnId = 500
  const worldId = 42

  const decks: WorldArchetypeProvider = {
    async getTemplate(id) {
      return id === TEMPLATE.id ? TEMPLATE : null
    },
    async all() {
      return [TEMPLATE]
    },
    defaultTemplateId() {
      return TEMPLATE.id
    },
  }

  const worlds: CreateBoundedWorldDeps['worlds'] = {
    async createBounded() {
      return { id: worldId }
    },
    async createOpen() {
      return { id: worldId }
    },
    async getWorld() {
      return null
    },
    async listWorlds() {
      return []
    },
    async listArchivedWorlds() {
      return []
    },
    async simulationsForHub() {
      return []
    },
    async archiveWorld() {},
    async unarchiveWorld() {},
    async cursor() {
      return { world_time: store.worldTime, current_scene_id: store.cursor.current_scene_id }
    },
    async setWorldTime(_id, worldTime) {
      store.worldTime = worldTime
    },
    async setShipClockMinutes(_id, minutes) {
      store.shipClockMinutes = minutes
    },
    async setCursor(_id, sceneId) {
      store.cursor.current_scene_id = sceneId
    },
    async setCurrentScene(sceneId) {
      store.cursor.current_scene_id = sceneId
    },
    async setSettingRegion() {},
    async setLayer() {},
    async setMetaStory() {},
    async setGenreTags() {},
  }

  const places: CreateBoundedWorldDeps['places'] = {
    async forWorld() {
      return store.places
    },
    async byId(id) {
      return store.places.find((p) => p.id === id) ?? null
    },
    async add(place) {
      const id = nextPlaceId++
      store.places.push({
        id,
        world_id: place.world_id,
        name: place.name,
        description: place.description,
        kind: place.kind,
        deck: place.deck,
        layout_hint: place.layout_hint,
        player_notes: null,
        osm_display_name: null,
        osm_street: null,
        osm_neighborhood: null,
        osm_lat: null,
        osm_lng: null,
        geo_status: 'unresolved',
        geo_resolved_at: null,
        created_at: '',
        updated_at: '',
      })
      return { id }
    },
    async currentPlaceForWorld() {
      return null
    },
    async nameById(id) {
      return store.places.find((p) => p.id === id)?.name ?? null
    },
    async insert(place) {
      const id = nextPlaceId++
      store.places.push({
        id,
        world_id: place.world_id,
        name: place.name,
        description: place.description,
        kind: place.kind,
        deck: null,
        layout_hint: null,
        player_notes: null,
        osm_display_name: null,
        osm_street: null,
        osm_neighborhood: null,
        osm_lat: null,
        osm_lng: null,
        geo_status: 'unresolved',
        geo_resolved_at: null,
        created_at: '',
        updated_at: '',
      })
      return { id }
    },
    async update() {},
    async merge() {},
    async moveCharactersToPlace() {},
    async moveScenesToPlace() {},
    async delete() {},
    async appendPlayerNotes() {},
    async setGeoResolution() {},
  }

  const placeConnections: CreateBoundedWorldDeps['placeConnections'] = {
    async forWorld() {
      return store.connections
    },
    async add(edges) {
      for (const edge of edges) {
        store.connections.push({
          id: nextConnId++,
          world_id: edge.world_id,
          from_place_id: edge.from_place_id,
          to_place_id: edge.to_place_id,
          kind: edge.kind,
          bidirectional: edge.bidirectional,
          created_at: null,
        })
      }
    },
  }

  const characters: CreateBoundedWorldDeps['characters'] = {
    async forWorld() {
      return store.characters
    },
    async inPlace(_wid, placeId) {
      return store.characters.filter((c) => c.current_place_id === placeId)
    },
    async add(character) {
      const id = nextCharacterId++
      store.characters.push({
        id,
        world_id: character.world_id,
        name: character.name,
        description: character.description,
        is_player: character.is_player,
        current_place_id: character.current_place_id,
        memorable_facts: null,
        status: 'active',
        active_goal: character.active_goal,
        current_attitude: null,
        observations: null,
        agency_level: 'npc',
        personal_goals: null,
        current_focus: character.role,
        recent_activity: null,
        private_beliefs: null,
        reveries: null,
        relationship_to_player: null,
        long_term_agenda: null,
        tool_access: null,
        appearance_count: 0,
        last_seen_turn_id: null,
        last_agent_tick_turn_id: null,
        player_notes: null,
        in_transit_to_place_id: null,
        arrival_world_time: null,
        last_known_situation: null,
        aliases: null,
        daily_loop: character.daily_loop,
        created_at: '',
        updated_at: '',
      })
      return { id }
    },
    async setPlace(characterId, placeId) {
      const c = store.characters.find((ch) => ch.id === characterId)
      if (c) c.current_place_id = placeId
    },
    async findByExactLowerName(_wid, name) {
      return store.characters.find((c) => c.name.toLowerCase() === name.toLowerCase()) ?? null
    },
    async insert() {
      return { id: nextCharacterId++ }
    },
    async update() {},
    async setActiveGoal() {},
    async setCurrentAttitude() {},
    async setObservations() {},
    async merge() {},
    async delete() {},
    async setAliases() {},
    async rename() {},
    async setPlayersPlace() {},
    async appendPlayerNotes() {},
    async recordAppearancesAndAutoPromote() {
      return { promoted: [], counted: 0, tiers: { local: [], nearby: [], distant: [], dormant: [], demoted: [] } }
    },
    async agentNpcsForTick() {
      return []
    },
    async setLastAgentTick() {},
    async findAgentNpcByName() {
      return null
    },
    async applyAgentNpcFields() {},
    async setDailyLoopIfEmpty() {},
  }

  const relationships: CreateBoundedWorldDeps['relationships'] = {
    async forWorld() {
      return store.relationships
    },
    async upsert(edges) {
      for (const edge of edges) {
        store.relationships.push({
          id: nextRelId++,
          world_id: edge.world_id,
          from_character_id: edge.from_character_id,
          to_character_id: edge.to_character_id,
          kind: edge.kind,
          valence: edge.valence,
          note: edge.note,
          updated_at: null,
        })
      }
    },
    async adjustValence(relationshipId, delta) {
      const rel = store.relationships.find((r) => r.id === relationshipId)
      if (rel) rel.valence += delta
    },
  }

  const scenes: CreateBoundedWorldDeps['scenes'] = {
    async forWorld() {
      return store.scenes
    },
    async activeForWorld() {
      return store.scenes.find((s) => s.status === 'active') ?? null
    },
    async add(scene) {
      const id = nextSceneId++
      store.scenes.push({
        id,
        world_id: scene.world_id,
        place_id: scene.place_id,
        title: scene.title,
        summary: null,
        scene_number: scene.scene_number,
        status: scene.status as Scene['status'],
        scene_mood: null,
        pace: null,
        focus: null,
        opened_at_turn: null,
        closed_at_turn: null,
        created_at: '',
        updated_at: '',
      })
      return { id }
    },
    async close() {},
    async insert() {
      return { id: nextSceneId++ }
    },
    async updateContext() {},
    async autoClose() {},
    async maxSceneNumber() {
      return store.scenes.reduce((max, s) => Math.max(max, s.scene_number), 0)
    },
    async currentSceneId() {
      return store.cursor.current_scene_id
    },
    async currentScenePlaceId() {
      return null
    },
  }

  const timeline: CreateBoundedWorldDeps['timeline'] = {
    async append() {},
  }

  const clock: Clock = {
    now() {
      return new Date('2026-06-09T00:00:00Z')
    },
    today() {
      return '2026-06-09'
    },
  }

  return {
    deps: {
      decks,
      crew: new StubEnsembleGenerator(),
      worlds,
      places,
      placeConnections,
      characters,
      relationships,
      drama: new StubDramaPort(),
      timeline,
      scenes,
      clock,
    },
    store,
  }
}

describe('createBoundedWorld', () => {
  it('seeds a bounded world: rooms, crew, and topology written', async () => {
    const { deps, store } = makeDeps()
    const result = await createBoundedWorld(
      { templateId: 'test-scout', name: 'Aurora', premise: 'p', ticks: 4 },
      deps,
    )
    expect(result.worldId).toBe(42)
    expect(store.places).toHaveLength(3)
    expect(store.connections).toHaveLength(2)
    // 2 crew (is_player=0) seeded + 1 player added later.
    expect(store.characters.filter((c) => c.is_player === 0)).toHaveLength(2)
  })

  it('runs the sim with the ticks it is given (advancing the clock)', async () => {
    const { deps, store } = makeDeps()
    await createBoundedWorld(
      { templateId: 'test-scout', name: 'Aurora', premise: 'p', ticks: 4 },
      deps,
    )
    // setWorldTime is only called by the sim when ticks > 0, so a non-null world
    // time is proof the sim ran for the passed ticks.
    expect(store.worldTime).not.toBeNull()
  })

  it('defaults to SIM_TICKS (12) when ticks is omitted', async () => {
    const { deps, store } = makeDeps()
    await createBoundedWorld({ templateId: 'test-scout', name: 'Aurora', premise: 'p' }, deps)
    // tickToWorldTime(12-1)=tickToWorldTime(11): 11 ticks past day 1 morning.
    // Bands cycle every 4 ticks ⇒ tick 11 is band index 3 = night, day 3.
    expect(store.worldTime).toBe('Day 3 — night')
  })

  it('seeds the ship-clock from the boarding world_time (starship P6)', async () => {
    const { deps, store } = makeDeps()
    await createBoundedWorld({ templateId: 'test-scout', name: 'Aurora', premise: 'p' }, deps)
    // Default 12 ticks ⇒ boarding world_time 'Day 3 — night'. worldTimeToMinutes
    // anchors a clock-less band phrase to a representative hour (night=23:00):
    // (3-1)*1440 + 23*60 = 4260. A non-null counter proves the clock is seeded.
    expect(store.shipClockMinutes).toBe(4260)
  })

  it('adds exactly one player on the Bridge (placeIds[0]) as a newcomer', async () => {
    const { deps, store } = makeDeps()
    await createBoundedWorld(
      { templateId: 'test-scout', name: 'Aurora', premise: 'p', ticks: 4 },
      deps,
    )
    const players = store.characters.filter((c) => c.is_player === 1)
    expect(players).toHaveLength(1)
    const player = players[0]
    const bridge = store.places.find((p) => p.name === 'Bridge')
    expect(player.current_place_id).toBe(bridge?.id)
    expect(player.name).toBe('Newcomer')
    expect(player.description).toBe('A newcomer: just come aboard.')
  })

  it('uses the entered player name when provided', async () => {
    const { deps, store } = makeDeps()
    await createBoundedWorld(
      { templateId: 'test-scout', name: 'Aurora', premise: 'p', playerName: '  Rook  ', ticks: 4 },
      deps,
    )
    const player = store.characters.find((c) => c.is_player === 1)
    expect(player?.name).toBe('Rook')
  })

  it('opens exactly one active scene on the Bridge, scene_number 1', async () => {
    const { deps, store } = makeDeps()
    const result = await createBoundedWorld(
      { templateId: 'test-scout', name: 'Aurora', premise: 'p', ticks: 4 },
      deps,
    )
    expect(store.scenes).toHaveLength(1)
    const scene = store.scenes[0]
    expect(scene.id).toBe(result.sceneId)
    expect(scene.status).toBe('active')
    expect(scene.scene_number).toBe(1)
    expect(scene.title).toBe('Arrival')
    const bridge = store.places.find((p) => p.name === 'Bridge')
    expect(scene.place_id).toBe(bridge?.id)
  })

  it('points the world cursor at the arrival scene', async () => {
    const { deps, store } = makeDeps()
    const result = await createBoundedWorld(
      { templateId: 'test-scout', name: 'Aurora', premise: 'p', ticks: 4 },
      deps,
    )
    expect(store.cursor.current_scene_id).toBe(result.sceneId)
  })

  it('returns the world, scene, and player ids', async () => {
    const { deps, store } = makeDeps()
    const result = await createBoundedWorld(
      { templateId: 'test-scout', name: 'Aurora', premise: 'p', ticks: 4 },
      deps,
    )
    expect(result.worldId).toBe(42)
    expect(store.scenes.some((s) => s.id === result.sceneId)).toBe(true)
    const player = store.characters.find((c) => c.id === result.playerId)
    expect(player?.is_player).toBe(1)
  })
})
