import { describe, expect, it } from 'vitest'

import type { SimulationSession, World } from '@/domain/entities'
import type { SessionRepository, WorldRepository } from '@/domain/ports'
import { inspectWorld, WorldNotFoundError } from '@/application/use-cases/inspect-world'
import { concealmentView } from '@/domain/services/concealment-view'

const inLifeSession: SimulationSession = {
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

  it('never hides the Animus; still scrubs a first-life premise', () => {
    expect(concealmentView(inLifeSession, hubWorld)).toEqual({
      concealed: true,
      hideWorld: false,
      hidePremise: false,
    })
    expect(concealmentView(inLifeSession, subWorld)).toEqual({
      concealed: true,
      hideWorld: false,
      hidePremise: true,
    })
  })

  it('relaxes once the player is back at the Animus', () => {
    const atHub = { ...inLifeSession, has_awoken: 1, status: 'in_hub' as const }
    expect(concealmentView(atHub, hubWorld).hideWorld).toBe(false)
    expect(concealmentView(atHub, hubWorld).concealed).toBe(false)
    expect(concealmentView(atHub, hubWorld).hidePremise).toBe(false)
  })
})

describe('inspectWorld concealment (leak-surface)', () => {
  function deps(world: World | null, session: SimulationSession | null) {
    const worlds = { async getWorld() { return world } } as unknown as WorldRepository
    const sessions = { async byWorld() { return session } } as unknown as SessionRepository
    return { worlds, sessions, project: () => ({ ok: true }) }
  }

  it('lets the player inspect the Animus while they are in a first life', async () => {
    const hub = { id: 10, world_layer: 'hub' } as unknown as World
    await expect(inspectWorld({ worldId: 10 }, deps(hub, inLifeSession))).resolves.toEqual({
      ok: true,
    })
  })

  it('allows inspecting the active first life', async () => {
    const sub = { id: 77, world_layer: 'subworld' } as unknown as World
    await expect(inspectWorld({ worldId: 77 }, deps(sub, inLifeSession))).resolves.toEqual({
      ok: true,
    })
  })

  it('still 404s a missing world', async () => {
    await expect(inspectWorld({ worldId: 10 }, deps(null, inLifeSession))).rejects.toBeInstanceOf(
      WorldNotFoundError,
    )
  })
})
