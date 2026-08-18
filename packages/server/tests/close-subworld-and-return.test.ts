import { describe, expect, it } from 'vitest'

import type { SimulationSession, World } from '@/domain/entities'
import type {
  CharacterRepository,
  PlaceRepository,
  SceneRepository,
  SessionRepository,
  SimRunRepository,
  TurnRepository,
  WorldArchetypeProvider,
  WorldRepository,
} from '@/domain/ports'
import { closeSubworldAndReturn } from '@/application/use-cases/close-subworld-and-return'
import type { SimRunReport, SimRunReportUpsert } from '@/domain/entities'

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

describe('closeSubworldAndReturn', () => {
  it('upserts one report and returns to hub (idempotent on key)', async () => {
    const upserts: SimRunReportUpsert[] = []
    let reportId = 0
    const simRuns: SimRunRepository = {
      async upsertByRun(r) {
        upserts.push(r)
        reportId += 1
        return {
          id: reportId,
          ...r,
          created_at: 'now',
        } as SimRunReport
      },
      async forHub() {
        return []
      },
      async bySubworld() {
        return null
      },
    }

    const calls = {
      flip: null as string | null,
      awoken: null as boolean | null,
      playerModel: null as string | null,
    }

    const worlds = {
      async getWorld(id: number) {
        if (id === 10) {
          return {
            id: 10,
            template_id: 'scout-vessel',
            world_layer: 'hub',
            meta_story_json: JSON.stringify({
              antagonist: 'Director Hale keeps the program',
            }),
            player_model_json: null,
            antagonist_character_id: null,
          } as unknown as World
        }
        return {
          id: 77,
          name: 'Sequence Vigil',
          genre_tags: '["roman"]',
          world_layer: 'subworld',
        } as unknown as World
      },
      async setCursor() {},
      async setPlayerModel(_id: number, json: string | null) {
        calls.playerModel = json
      },
      async setAntagonistCharacterId() {},
    } as unknown as WorldRepository

    const places = {
      async forWorld(id: number) {
        if (id === 10) {
          return [
            { id: 100, name: 'Bridge' },
            { id: 101, name: 'Sim Deck' },
          ]
        }
        return [{ id: 1, name: 'Forum' }]
      },
    } as unknown as PlaceRepository

    const scenes = {
      async maxSceneNumber() {
        return 0
      },
      async add() {
        return { id: 555 }
      },
    } as unknown as SceneRepository

    const characters = {
      async setPlayersPlace() {},
      async forWorld() {
        return [
          {
            id: 3,
            name: 'Director Hale',
            is_player: 0,
            clearance_level: 'public_crew',
            status: 'active',
            agency_level: 'local',
          },
        ]
      },
      async setClearanceLevel() {},
      async setSpeechRegisterIfEmpty() {},
      async add() {
        return { id: 99 }
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
        return {
          id: 'scout-vessel',
          simulationRoomKey: 'sim_deck',
          rooms: [
            { key: 'bridge', name: 'Bridge' },
            { key: 'sim_deck', name: 'Sim Deck' },
          ],
        }
      },
    } as unknown as WorldArchetypeProvider

    const turns = {
      async recentTurns() {
        return [
          { id: 1, role: 'user' as const, content: 'I press on' },
          { id: 2, role: 'assistant' as const, content: 'You fall motionless.' },
        ]
      },
    } as unknown as TurnRepository

    const deps = {
      worlds,
      places,
      scenes,
      characters,
      sessions,
      decks,
      simRuns,
      turns,
    }

    const first = await closeSubworldAndReturn(
      { session, subworldId: 77, exitKind: 'death', sourceTurnId: 2 },
      deps,
    )
    const second = await closeSubworldAndReturn(
      { session, subworldId: 77, exitKind: 'death', sourceTurnId: null },
      deps,
    )

    expect(first).toMatchObject({ hubWorldId: 10, sceneId: 555 })
    expect(second).toMatchObject({ hubWorldId: 10, sceneId: 555 })
    expect(upserts).toHaveLength(2)
    expect(upserts[0]?.codename).toBe('Sequence Vigil')
    expect(upserts[0]?.status).toBe('death_exit')
    expect(upserts[0]?.hub_world_id).toBe(10)
    expect(upserts[0]?.subworld_id).toBe(77)
    // Second close may pass null sourceTurnId
    expect(upserts[1]?.source_turn_id).toBeNull()
    expect(calls.flip).toBe('in_hub')
    expect(calls.awoken).toBe(true)
    expect(calls.playerModel).toBeTruthy()
  })
})
