import { describe, expect, it } from 'vitest'

import type { SimulationSession } from '@/domain/entities'
import type { SessionRepository, WorldRepository } from '@/domain/ports'
import { enterSubworld } from '@/application/use-cases/enter-subworld'
import { resolveActiveWorldId } from '@/domain/services/resolve-active-world'

const initialState = { time: 'Day 1', location: 'Rome', identity: 'a newcomer' }

describe('enterSubworld', () => {
  it('seeds a subworld linked to the hub, gates geocoding off, and points the session', async () => {
    const calls = {
      createOpen: [] as unknown[],
      setSettingRegion: 0,
      setLayer: [] as Array<[number, string, number | null]>,
      setSubworld: [] as Array<[number, number | null]>,
      flips: [] as string[],
    }
    const worlds = {
      async createOpen(input: unknown) {
        calls.createOpen.push(input)
        return { id: 77 }
      },
      async setSettingRegion() {
        calls.setSettingRegion += 1
      },
      async setLayer(worldId: number, layer: 'hub' | 'subworld' | 'standalone', parent: number | null) {
        calls.setLayer.push([worldId, layer, parent])
      },
    } as unknown as WorldRepository
    const sessions = {
      async setSubworld(id: number, sub: number | null) {
        calls.setSubworld.push([id, sub])
      },
      async flip(_id: number, status: string) {
        calls.flips.push(status)
      },
    } as unknown as SessionRepository

    const result = await enterSubworld(
      { hubWorldId: 10, sessionId: 5, name: 'Protocol 457', premise: 'late-Republic Rome', initialState },
      { worlds, sessions },
    )

    expect(result.subworldId).toBe(77)
    expect(calls.createOpen).toHaveLength(1)
    // Geocoding gated off — the no-op extractor returns null, so no region write.
    expect(calls.setSettingRegion).toBe(0)
    expect(calls.setLayer).toEqual([[77, 'subworld', 10]])
    expect(calls.setSubworld).toEqual([[5, 77]])
    expect(calls.flips).toEqual(['in_subworld'])
  })
})

describe('resolveActiveWorldId', () => {
  const base: SimulationSession = {
    id: 1,
    hub_world_id: 10,
    subworld_world_id: 77,
    player_identity: 'X',
    status: 'in_subworld',
    has_awoken: 0,
    lucidity: 0,
    created_at: '',
    updated_at: '',
  }

  it('returns the url id when there is no session (standalone world)', () => {
    expect(resolveActiveWorldId(42, null)).toBe(42)
  })

  it('returns the subworld while playing a simulation', () => {
    expect(resolveActiveWorldId(10, base)).toBe(77)
  })

  it('returns the hub once the player is in the hub', () => {
    expect(resolveActiveWorldId(10, { ...base, status: 'in_hub' })).toBe(10)
  })

  it('falls back to the hub if in_subworld but no subworld is set', () => {
    expect(resolveActiveWorldId(10, { ...base, subworld_world_id: null })).toBe(10)
  })
})
