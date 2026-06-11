import { describe, expect, it } from 'vitest'

import type { SimulationSession, World } from '@/domain/entities'
import type {
  SceneRepository,
  SessionRepository,
  WorldArchetypeProvider,
  WorldRepository,
} from '@/domain/ports'
import type { CharacterRepository } from '@/domain/ports/character-repository'
import type { PlaceRepository } from '@/domain/ports/place-repository'
import { returnToHub } from '@/application/use-cases/return-to-hub'

const session: SimulationSession = {
  id: 9,
  hub_world_id: 10,
  subworld_world_id: 77,
  player_identity: 'Andrew',
  status: 'in_subworld',
  has_awoken: 0,
  lucidity: 0,
  created_at: '',
  updated_at: '',
}

const hub = { id: 10, template_id: 'scout-vessel' } as unknown as World

const archetype = {
  id: 'scout-vessel',
  simulationRoomKey: 'sim_deck',
  rooms: [
    { key: 'bridge', name: 'Bridge' },
    { key: 'sim_deck', name: 'Sim Deck' },
  ],
}

describe('returnToHub', () => {
  it('surfaces the player into the hub simulation room and awakens the session', async () => {
    const calls = {
      playerPlace: null as [number, number] | null,
      sceneAdded: null as { place_id: number; title: string; scene_number: number } | null,
      cursor: null as [number, number] | null,
      flip: null as string | null,
      awoken: null as boolean | null,
    }
    const worlds = {
      async getWorld() {
        return hub
      },
      async setCursor(worldId: number, sceneId: number) {
        calls.cursor = [worldId, sceneId]
      },
    } as unknown as WorldRepository
    const places = {
      async forWorld() {
        return [
          { id: 100, name: 'Bridge' },
          { id: 101, name: 'Sim Deck' },
        ]
      },
    } as unknown as PlaceRepository
    const scenes = {
      async maxSceneNumber() {
        return 1
      },
      async add(s: { place_id: number; title: string; scene_number: number }) {
        calls.sceneAdded = s
        return { id: 555 }
      },
    } as unknown as SceneRepository
    const characters = {
      async setPlayersPlace(placeId: number, worldId: number) {
        calls.playerPlace = [placeId, worldId]
      },
    } as unknown as CharacterRepository
    const sessions = {
      async flip(_id: number, status: string) {
        calls.flip = status
      },
      async setAwoken(_id: number, v: boolean) {
        calls.awoken = v
      },
    } as unknown as SessionRepository
    const decks = {
      async getTemplate() {
        return archetype
      },
    } as unknown as WorldArchetypeProvider

    const result = await returnToHub(
      { session },
      { worlds, places, scenes, characters, sessions, decks },
    )

    expect(result).toEqual({ hubWorldId: 10, sceneId: 555 })
    // Player moved to the Sim Deck place (id 101), in the hub world (10).
    expect(calls.playerPlace).toEqual([101, 10])
    expect(calls.sceneAdded).toMatchObject({ place_id: 101, title: 'Awakening', scene_number: 2 })
    expect(calls.cursor).toEqual([10, 555])
    expect(calls.flip).toBe('in_hub')
    expect(calls.awoken).toBe(true)
  })
})
