import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createWorld } from '@/application/use-cases/create-world'
import { seedBoundedWorld } from '@/application/use-cases/seed-bounded-world'
import { MongoCharacterRepository } from '@/infrastructure/persistence/mongo/repositories/character-repository.mongo'
import { MongoDossierRepository } from '@/infrastructure/persistence/mongo/repositories/dossier-repository.mongo'
import { MongoOccupancyRepository } from '@/infrastructure/persistence/mongo/repositories/occupancy-repository.mongo'
import { MongoPlaceConnectionRepository } from '@/infrastructure/persistence/mongo/repositories/place-connection-repository.mongo'
import { MongoPlaceRepository } from '@/infrastructure/persistence/mongo/repositories/place-repository.mongo'
import { MongoRelationshipRepository } from '@/infrastructure/persistence/mongo/repositories/relationship-repository.mongo'
import { MongoSceneRepository } from '@/infrastructure/persistence/mongo/repositories/scene-repository.mongo'
import { MongoWorldRepository } from '@/infrastructure/persistence/mongo/repositories/world-repository.mongo'
import { SystemClock } from '@/infrastructure/clock/system-clock'
import { AuthoredDeckPlanProvider } from '@/infrastructure/world-gen/deck-plan-provider'
import { StubCrewGenerator } from '@/infrastructure/world-gen/stub-crew-generator'
import { getNarratorWorldStateVia } from '@/lib/world-state'

import { replSetAvailable, startReplSet, type ReplSetHandle } from './replset'

// Mongo turn-pipeline e2e harness (P3 cutover). Boots a real MongoMemoryReplSet
// and drives the actual use cases (CreateWorld / SeedBoundedWorld) against the
// Mongo port set, asserting both worlds round-trip through the ports. Each later
// cutover phase un-skips a slice; the final exit criterion (a turn played
// end-to-end on Mongo) is the skipped placeholder at the bottom, un-skipped in
// Phase 5. Guarded behind availability: if the memory server can't run here,
// every test skips (mongo work complete-but-unverified, NEVER gate-passed).

const available = await replSetAvailable()
const d = available ? describe : describe.skip

if (!available) {
  console.warn(
    '[mongo suite] MongoMemoryReplSet unavailable — skipping mongo turn-pipeline tests. ' +
      'The mongo adapter code is complete but UNVERIFIED in this environment.',
  )
}

d('mongo turn pipeline (e2e)', () => {
  let h: ReplSetHandle

  beforeAll(async () => {
    const handle = await startReplSet()
    if (!handle) throw new Error('replica set unexpectedly unavailable')
    h = handle
  }, 120_000)

  afterAll(async () => {
    if (h) await h.stop()
  })

  it('creates an OPEN world via the CreateWorld use case, readable through the ports', async () => {
    const worlds = new MongoWorldRepository(h.ctx)
    const places = new MongoPlaceRepository(h.ctx)
    const characters = new MongoCharacterRepository(h.ctx)

    const { worldId } = await createWorld(
      {
        name: 'Mevagissey 1897',
        premise: 'a Cornish fishing village at the close of the century',
        initialState: {
          time: 'dawn',
          location: 'Mevagissey harbour — Cornwall',
          identity: 'a returning sailor',
        },
      },
      { worlds, extractSettingRegion: async () => null },
    )
    expect(typeof worldId).toBe('number')

    // The world appears in the (non-archived) world list.
    const list = await worlds.listWorlds()
    expect(list.some((w) => w.id === worldId)).toBe(true)

    // The seed place + player character round-trip through the ports.
    const seededPlaces = await places.forWorld(worldId)
    expect(seededPlaces).toHaveLength(1)
    const seededCharacters = await characters.forWorld(worldId)
    expect(seededCharacters.some((c) => c.is_player === 1)).toBe(true)
  })

  it('assembles narrator context from MONGO via getNarratorWorldStateVia (port-driven read)', async () => {
    const worlds = new MongoWorldRepository(h.ctx)
    const scenes = new MongoSceneRepository(h.ctx)
    const places = new MongoPlaceRepository(h.ctx)
    const characters = new MongoCharacterRepository(h.ctx)
    const occupancy = new MongoOccupancyRepository(h.ctx)
    const dossiers = new MongoDossierRepository(h.ctx)

    const { worldId } = await createWorld(
      {
        name: 'Polperro 1901',
        premise: 'a smuggler village waking to the modern age',
        initialState: {
          time: 'dusk',
          location: 'Polperro quay — Cornwall',
          identity: 'a customs officer',
        },
      },
      { worlds, extractSettingRegion: async () => null },
    )

    // The P2 assembler now sources its rows from the injected READ PORTS — here
    // the Mongo port set — so this asserts the assembled context reads MONGO,
    // not SQLite.
    const state = await getNarratorWorldStateVia(
      { worlds, scenes, places, characters, occupancy, dossiers },
      worldId,
    )

    // Active scene + its place come back from Mongo.
    expect(state.currentScene).not.toBeNull()
    expect(state.currentPlace).not.toBeNull()
    const seededPlaces = await places.forWorld(worldId)
    expect(state.currentPlace?.id).toBe(seededPlaces[0]?.id)

    // The seeded player character is present and among the known characters.
    const seededCharacters = await characters.forWorld(worldId)
    expect(state.knownCharacters.map((c) => c.id).sort()).toEqual(
      seededCharacters.map((c) => c.id).sort(),
    )
    expect(state.presentCharacters.some((c) => c.is_player === 1)).toBe(true)
    expect(state.knownPlaces.map((p) => p.id)).toContain(seededPlaces[0]?.id)
  })

  it('seeds a BOUNDED world via SeedBoundedWorld (StubCrewGenerator), readable through the ports', async () => {
    const decks = new AuthoredDeckPlanProvider()
    const worlds = new MongoWorldRepository(h.ctx)
    const places = new MongoPlaceRepository(h.ctx)
    const placeConnections = new MongoPlaceConnectionRepository(h.ctx)
    const characters = new MongoCharacterRepository(h.ctx)
    const relationships = new MongoRelationshipRepository(h.ctx)

    const result = await seedBoundedWorld(
      { templateId: decks.defaultTemplateId(), name: 'Scout Vessel', premise: 'a long survey run' },
      {
        decks,
        crew: new StubCrewGenerator(),
        worlds,
        places,
        placeConnections,
        characters,
        relationships,
        clock: new SystemClock(),
      },
    )
    expect(typeof result.worldId).toBe('number')

    // The bounded world appears in the world list and is flagged bounded.
    const list = await worlds.listWorlds()
    expect(list.some((w) => w.id === result.worldId)).toBe(true)
    const world = await worlds.getWorld(result.worldId)
    expect(world?.spatial_mode).toBe('bounded')

    // Its rooms + crew round-trip through the ports.
    const seededPlaces = await places.forWorld(result.worldId)
    expect(seededPlaces.length).toBe(result.placeIds.length)
    expect(seededPlaces.length).toBeGreaterThan(0)
    const seededCharacters = await characters.forWorld(result.worldId)
    expect(seededCharacters.length).toBe(result.characterIds.length)
    expect(seededCharacters.length).toBeGreaterThan(0)
  })

  // Final exit criterion of the cutover — un-skipped in Phase 5 once the opening
  // turn + narrate-turn loop are wired through the container on Mongo.
  it.skip('plays a turn end-to-end on Mongo (un-skipped in Phase 5)', () => {
    // Placeholder: create → opening turn → player turn → archivist mutates the
    // Mongo dossier/characters/places → narrator context reads them back, all on
    // PERSISTENCE=mongo. Asserted here once Phase 5 routes narrate-turn through
    // the injected Mongo port bag.
  })
})
