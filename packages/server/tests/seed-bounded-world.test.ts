import { beforeEach, describe, expect, it } from 'vitest'

import {
  DisconnectedTopologyError,
  TemplateNotFoundError,
  seedBoundedWorld,
} from '@/application/use-cases/seed-bounded-world'
import type { SeedBoundedWorldDeps } from '@/application/use-cases/seed-bounded-world'
import type {
  CharacterRepository,
  Clock,
  DeckPlanProvider,
  DeckPlanTemplate,
  PlaceConnectionInput,
  PlaceConnectionRepository,
  PlaceRepository,
  RelationshipInput,
  RelationshipRepository,
  WorldRepository,
} from '@/domain/ports'
import type { CharacterInput } from '@/domain/ports/character-repository'
import type { PlaceInput } from '@/domain/ports/place-repository'
import type { CreateBoundedWorldInput } from '@/domain/ports/world-repository'
import { StubCrewGenerator } from '@/infrastructure/world-gen/stub-crew-generator'

// Unit test for SeedBoundedWorld (starship P1). Pure orchestration exercised with
// in-memory fake ports that record their calls — no DB, no LLM (the deterministic
// StubCrewGenerator stands in for the Grok seam). Asserts the seam writes one
// bounded world, one place per room, an edge per template edge, one character per
// crew member at the right room, the relationship graph, and that it rejects a
// disconnected template.

// --- A small connected template: bridge ── mess ── quarters (2 edges, 3 rooms,
// 2 crew slots). Distinct from the authored scout so the test owns its topology.
const CONNECTED_TEMPLATE: DeckPlanTemplate = {
  id: 'test-connected',
  name: 'Test Vessel',
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

// Same rooms, but the third room has no edge — a disconnected topology.
const DISCONNECTED_TEMPLATE: DeckPlanTemplate = {
  ...CONNECTED_TEMPLATE,
  id: 'test-disconnected',
  edges: [{ from: 'bridge', to: 'mess', kind: 'corridor', bidirectional: true }],
}

type Recorder = {
  worldsCreated: CreateBoundedWorldInput[]
  placesAdded: PlaceInput[]
  edgesAdded: PlaceConnectionInput[]
  charactersAdded: CharacterInput[]
  relationshipsUpserted: RelationshipInput[]
}

function makeDeps(template: DeckPlanTemplate | null): { deps: SeedBoundedWorldDeps; rec: Recorder } {
  const rec: Recorder = {
    worldsCreated: [],
    placesAdded: [],
    edgesAdded: [],
    charactersAdded: [],
    relationshipsUpserted: [],
  }
  let nextPlaceId = 100
  let nextCharacterId = 200

  const decks: DeckPlanProvider = {
    async getTemplate(id) {
      return template && template.id === id ? template : null
    },
    defaultTemplateId() {
      return template?.id ?? ''
    },
  }
  const worlds: WorldRepository = {
    async createBounded(input) {
      rec.worldsCreated.push(input)
      return { id: 42 }
    },
    async createOpen() {
      return { id: 42 }
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
    async archiveWorld() {},
    async unarchiveWorld() {},
    async cursor() {
      return { world_time: null, current_scene_id: null }
    },
    async setWorldTime() {},
    async setCursor() {},
    async setCurrentScene() {},
    async setSettingRegion() {},
  }
  const places: PlaceRepository = {
    async forWorld() {
      return []
    },
    async byId() {
      return null
    },
    async add(place) {
      rec.placesAdded.push(place)
      return { id: nextPlaceId++ }
    },
    async currentPlaceForWorld() {
      return null
    },
    async nameById() {
      return null
    },
    async insert() {
      return { id: nextPlaceId++ }
    },
    async update() {},
    async merge() {},
    async moveCharactersToPlace() {},
    async moveScenesToPlace() {},
    async delete() {},
    async appendPlayerNotes() {},
    async setGeoResolution() {},
  }
  const placeConnections: PlaceConnectionRepository = {
    async forWorld() {
      return []
    },
    async add(edges) {
      rec.edgesAdded.push(...edges)
    },
  }
  const characters: CharacterRepository = {
    async forWorld() {
      return []
    },
    async inPlace() {
      return []
    },
    async add(character) {
      rec.charactersAdded.push(character)
      return { id: nextCharacterId++ }
    },
    async setPlace() {},
    async findByExactLowerName() {
      return null
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
  const relationships: RelationshipRepository = {
    async forWorld() {
      return []
    },
    async upsert(edges) {
      rec.relationshipsUpserted.push(...edges)
    },
    async adjustValence() {},
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
    deps: { decks, crew: new StubCrewGenerator(), worlds, places, placeConnections, characters, relationships, clock },
    rec,
  }
}

describe('seedBoundedWorld', () => {
  let setup: { deps: SeedBoundedWorldDeps; rec: Recorder }

  beforeEach(() => {
    setup = makeDeps(CONNECTED_TEMPLATE)
  })

  it('throws TemplateNotFound when the template id is unknown', async () => {
    const { deps } = makeDeps(null)
    await expect(
      seedBoundedWorld(
        { templateId: 'missing', name: 'X', premise: 'p' },
        deps,
      ),
    ).rejects.toBeInstanceOf(TemplateNotFoundError)
  })

  it('creates exactly one bounded world recording the template id', async () => {
    await seedBoundedWorld(
      { templateId: 'test-connected', name: 'Aurora', premise: 'lost in the deep' },
      setup.deps,
    )
    expect(setup.rec.worldsCreated).toHaveLength(1)
    expect(setup.rec.worldsCreated[0].templateId).toBe('test-connected')
    expect(setup.rec.worldsCreated[0].name).toBe('Aurora')
  })

  it('writes one place per template room with deck carried through', async () => {
    await seedBoundedWorld(
      { templateId: 'test-connected', name: 'Aurora', premise: 'p' },
      setup.deps,
    )
    expect(setup.rec.placesAdded).toHaveLength(3)
    expect(setup.rec.placesAdded.map((p) => p.name).sort()).toEqual(['Bridge', 'Mess', 'Quarters'])
    const quarters = setup.rec.placesAdded.find((p) => p.name === 'Quarters')
    expect(quarters?.deck).toBe('B')
    expect(setup.rec.placesAdded.every((p) => p.world_id === 42)).toBe(true)
  })

  it('writes an edge for every template edge mapped to place ids', async () => {
    await seedBoundedWorld(
      { templateId: 'test-connected', name: 'Aurora', premise: 'p' },
      setup.deps,
    )
    expect(setup.rec.edgesAdded).toHaveLength(2)
    const allPlaceIds = new Set(setup.rec.placesAdded.map((_, i) => 100 + i))
    for (const edge of setup.rec.edgesAdded) {
      expect(allPlaceIds.has(edge.from_place_id)).toBe(true)
      expect(allPlaceIds.has(edge.to_place_id)).toBe(true)
      expect(edge.bidirectional).toBe(1)
    }
  })

  it('writes one character per crew member at their home room with resolved daily loop', async () => {
    const result = await seedBoundedWorld(
      { templateId: 'test-connected', name: 'Aurora', premise: 'p' },
      setup.deps,
    )
    expect(setup.rec.charactersAdded).toHaveLength(2)
    expect(result.characterIds).toHaveLength(2)

    const bridgePlace = setup.rec.placesAdded.findIndex((p) => p.name === 'Bridge')
    const bridgePlaceId = 100 + bridgePlace
    const captain = setup.rec.charactersAdded.find((c) => c.role === 'captain')
    expect(captain).toBeDefined()
    expect(captain?.current_place_id).toBe(bridgePlaceId)
    expect(captain?.is_player).toBe(0)

    // daily_loop is JSON; every band's place resolves to a real seeded place id.
    const loop = JSON.parse(captain?.daily_loop ?? '{}') as Record<string, { place_id: number }>
    const seededIds = new Set(setup.rec.placesAdded.map((_, i) => 100 + i))
    for (const band of Object.values(loop)) {
      expect(seededIds.has(band.place_id)).toBe(true)
    }
  })

  it('upserts the relationship graph mapping roles to character ids', async () => {
    await seedBoundedWorld(
      { templateId: 'test-connected', name: 'Aurora', premise: 'p' },
      setup.deps,
    )
    // Stub emits an ally chain between consecutive crew → 1 edge for 2 crew.
    expect(setup.rec.relationshipsUpserted).toHaveLength(1)
    const characterIds = new Set(setup.rec.charactersAdded.map((_, i) => 200 + i))
    for (const rel of setup.rec.relationshipsUpserted) {
      expect(characterIds.has(rel.from_character_id)).toBe(true)
      expect(characterIds.has(rel.to_character_id)).toBe(true)
      expect(rel.valence).toBeGreaterThanOrEqual(-1)
      expect(rel.valence).toBeLessThanOrEqual(1)
    }
  })

  it('returns the world id, all place ids, and all character ids', async () => {
    const result = await seedBoundedWorld(
      { templateId: 'test-connected', name: 'Aurora', premise: 'p' },
      setup.deps,
    )
    expect(result.worldId).toBe(42)
    expect(result.placeIds).toHaveLength(3)
    expect(result.characterIds).toHaveLength(2)
    expect(result.placeIds.every((id) => typeof id === 'number')).toBe(true)
  })

  it('throws DisconnectedTopology when the template graph is not fully connected', async () => {
    const { deps } = makeDeps(DISCONNECTED_TEMPLATE)
    await expect(
      seedBoundedWorld(
        { templateId: 'test-disconnected', name: 'Broken', premise: 'p' },
        deps,
      ),
    ).rejects.toBeInstanceOf(DisconnectedTopologyError)
  })
})
