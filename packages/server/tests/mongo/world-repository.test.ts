import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { MongoCharacterRepository } from '@/infrastructure/persistence/mongo/repositories/character-repository.mongo'
import { MongoPlaceRepository } from '@/infrastructure/persistence/mongo/repositories/place-repository.mongo'
import { MongoSceneRepository } from '@/infrastructure/persistence/mongo/repositories/scene-repository.mongo'
import { MongoWorldRepository } from '@/infrastructure/persistence/mongo/repositories/world-repository.mongo'

import { replSetAvailable, startReplSet, type ReplSetHandle } from './replset'

// Mongo WorldRepository regression suite (P3 cutover, Phase 0 safety net). Runs
// against a real MongoMemoryReplSet so the integer-id model (nextSeq) and the
// open-world seed are verified end-to-end through the PORT — not the lib/SQL.
// Guarded behind availability: if the memory server can't run here, every test
// skips and the mongo work is reported complete-but-unverified (NEVER
// gate-passed).

const available = await replSetAvailable()
const d = available ? describe : describe.skip

if (!available) {
  console.warn(
    '[mongo suite] MongoMemoryReplSet unavailable — skipping mongo WorldRepository tests. ' +
      'The mongo adapter code is complete but UNVERIFIED in this environment.',
  )
}

d('mongo WorldRepository', () => {
  let h: ReplSetHandle

  beforeAll(async () => {
    const handle = await startReplSet()
    if (!handle) throw new Error('replica set unexpectedly unavailable')
    h = handle
  }, 120_000)

  afterAll(async () => {
    if (h) await h.stop()
  })

  describe('createBounded → getWorld', () => {
    it('round-trips an INTEGER id with spatial_mode=bounded', async () => {
      const worlds = new MongoWorldRepository(h.ctx)
      const { id } = await worlds.createBounded({
        name: 'Aurora',
        premise: 'lost in the deep',
        initialStateJson: JSON.stringify({ premise: 'p', ship_name: 'Aurora' }),
        templateId: 'scout',
      })
      expect(typeof id).toBe('number')
      expect(Number.isInteger(id)).toBe(true)

      const world = await worlds.getWorld(id)
      expect(world).not.toBeNull()
      expect(world?.id).toBe(id)
      expect(typeof world?.id).toBe('number')
      expect(world?.spatial_mode).toBe('bounded')
      expect(world?.ship_clock_minutes).toBeNull()
    })
  })

  describe('setShipClockMinutes', () => {
    it('round-trips the ship-clock counter via getWorld', async () => {
      const worlds = new MongoWorldRepository(h.ctx)
      const { id } = await worlds.createBounded({
        name: 'Clockwork',
        premise: 'mid-watch',
        initialStateJson: JSON.stringify({ premise: 'p' }),
        templateId: 'scout',
      })
      let world = await worlds.getWorld(id)
      expect(world?.ship_clock_minutes).toBeNull()

      await worlds.setShipClockMinutes(id, 3990)
      world = await worlds.getWorld(id)
      expect(world?.ship_clock_minutes).toBe(3990)
    })
  })

  describe('createOpen → getWorld + seed rows', () => {
    it('round-trips an INTEGER id with spatial_mode=open and seeds place/player/scene', async () => {
      const worlds = new MongoWorldRepository(h.ctx)
      const places = new MongoPlaceRepository(h.ctx)
      const characters = new MongoCharacterRepository(h.ctx)
      const scenes = new MongoSceneRepository(h.ctx)

      const { id } = await worlds.createOpen({
        name: 'Mevagissey 1897',
        premise: 'a Cornish fishing village',
        initialState: {
          time: 'dawn',
          location: 'Mevagissey harbour — Cornwall',
          identity: 'a returning sailor',
          playerName: 'Rook',
        },
      })
      expect(typeof id).toBe('number')
      expect(Number.isInteger(id)).toBe(true)

      const world = await worlds.getWorld(id)
      expect(world?.spatial_mode).toBe('open')

      // The seed place exists (kind derived from the location).
      const seededPlaces = await places.forWorld(id)
      expect(seededPlaces).toHaveLength(1)
      expect(seededPlaces[0].name).toBe('Mevagissey harbour')

      // The player character exists, standing in the seed place.
      const seededCharacters = await characters.forWorld(id)
      expect(seededCharacters).toHaveLength(1)
      const player = seededCharacters[0]
      expect(player.is_player).toBe(1)
      expect(player.name).toBe('Rook')
      expect(player.current_place_id).toBe(seededPlaces[0].id)

      // An active Scene 1 exists, pointed at by the world cursor.
      const activeScene = await scenes.activeForWorld(id)
      expect(activeScene).not.toBeNull()
      expect(activeScene?.scene_number).toBe(1)
      expect(activeScene?.place_id).toBe(seededPlaces[0].id)

      const cursor = await worlds.cursor(id)
      expect(cursor.world_time).toBe('dawn')
      expect(cursor.current_scene_id).toBe(activeScene?.id)
    })
  })
})
