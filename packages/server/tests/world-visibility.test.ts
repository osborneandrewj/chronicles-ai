import { describe, expect, it } from 'vitest'

import type { SimulationSession } from '@/domain/entities'
import { isWorldListVisible } from '@/domain/services/world-visibility'

const session = (over: Partial<SimulationSession>): SimulationSession => ({
  id: 1,
  hub_world_id: 10,
  subworld_world_id: 20,
  player_identity: 'X',
  status: 'in_subworld',
  has_awoken: 0,
  lucidity: 0,
  created_at: '',
  updated_at: '',
  ...over,
})

describe('isWorldListVisible', () => {
  it('always shows a standalone world', () => {
    expect(isWorldListVisible({ id: 5, world_layer: 'standalone' }, null)).toBe(true)
  })

  it('always shows the Animus, even before any awakening', () => {
    const hub = { id: 10, world_layer: 'hub' as const }
    expect(isWorldListVisible(hub, session({ has_awoken: 0, status: 'in_subworld' }))).toBe(true)
    expect(isWorldListVisible(hub, session({ has_awoken: 1, status: 'in_hub' }))).toBe(true)
    expect(isWorldListVisible(hub, null)).toBe(true)
  })

  it('never lists a first life as a top-level home card', () => {
    const sim = { id: 20, world_layer: 'subworld' as const }
    expect(isWorldListVisible(sim, session({ has_awoken: 0, subworld_world_id: 20 }))).toBe(false)
    expect(isWorldListVisible(sim, session({ has_awoken: 1, status: 'in_hub' }))).toBe(false)
    expect(isWorldListVisible({ id: 99, world_layer: 'subworld' }, null)).toBe(false)
  })
})
