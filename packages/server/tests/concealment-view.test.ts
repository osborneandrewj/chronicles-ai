import { describe, expect, it } from 'vitest'

import type { SimulationSession, World } from '@/domain/entities'
import type { SessionRepository, WorldRepository } from '@/domain/ports'
import { inspectWorld, WorldNotFoundError } from '@/application/use-cases/inspect-world'
import { concealmentView } from '@/domain/services/concealment-view'

const concealedSession: SimulationSession = {
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

const hubWorld = { id: 10, world_layer: 'hub' as const }
const subWorld = { id: 77, world_layer: 'subworld' as const }

describe('concealmentView', () => {
  it('is not concealed without a session (standalone world)', () => {
    const v = concealmentView(null, { id: 5, world_layer: 'standalone' })
    expect(v).toEqual({ concealed: false, hideWorld: false, hidePremise: false })
  })

  it('hides the hub and scrubs premise while concealed', () => {
    expect(concealmentView(concealedSession, hubWorld)).toEqual({
      concealed: true,
      hideWorld: true,
      hidePremise: true,
    })
    // The subworld stays visible but its premise is scrubbed.
    expect(concealmentView(concealedSession, subWorld)).toEqual({
      concealed: true,
      hideWorld: false,
      hidePremise: true,
    })
  })

  it('relaxes once the player has awoken', () => {
    const awoken = { ...concealedSession, has_awoken: 1, status: 'in_hub' as const }
    expect(concealmentView(awoken, hubWorld).hideWorld).toBe(false)
    expect(concealmentView(awoken, hubWorld).concealed).toBe(false)
  })
})

describe('inspectWorld concealment (leak-surface)', () => {
  function deps(world: World | null, session: SimulationSession | null) {
    const worlds = { async getWorld() { return world } } as unknown as WorldRepository
    const sessions = { async byWorld() { return session } } as unknown as SessionRepository
    return { worlds, sessions, project: () => ({ ok: true }) }
  }

  it('treats the concealed hub as not-found — no surface confirms it exists', async () => {
    const hub = { id: 10, world_layer: 'hub' } as unknown as World
    await expect(
      inspectWorld({ worldId: 10 }, deps(hub, concealedSession)),
    ).rejects.toBeInstanceOf(WorldNotFoundError)
  })

  it('allows inspecting the active subworld', async () => {
    const sub = { id: 77, world_layer: 'subworld' } as unknown as World
    await expect(inspectWorld({ worldId: 77 }, deps(sub, concealedSession))).resolves.toEqual({
      ok: true,
    })
  })

  it('allows inspecting the hub once awoken', async () => {
    const hub = { id: 10, world_layer: 'hub' } as unknown as World
    const awoken = { ...concealedSession, has_awoken: 1, status: 'in_hub' as const }
    await expect(inspectWorld({ worldId: 10 }, deps(hub, awoken))).resolves.toEqual({ ok: true })
  })
})
