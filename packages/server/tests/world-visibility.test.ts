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

  it('hides the hub while concealed, shows it once awoken', () => {
    const hub = { id: 10, world_layer: 'hub' as const }
    expect(isWorldListVisible(hub, session({ has_awoken: 0, status: 'in_subworld' }))).toBe(false)
    expect(isWorldListVisible(hub, session({ has_awoken: 1, status: 'in_hub' }))).toBe(true)
    expect(isWorldListVisible(hub, null)).toBe(false)
  })

  it('shows the active simulation only while concealed', () => {
    const sim = { id: 20, world_layer: 'subworld' as const }
    expect(isWorldListVisible(sim, session({ has_awoken: 0, subworld_world_id: 20 }))).toBe(true)
    // After awakening it moves into the hub archive — hidden from home.
    expect(isWorldListVisible(sim, session({ has_awoken: 1, status: 'in_hub' }))).toBe(false)
  })

  it('hides a past simulation the session no longer points at', () => {
    // byWorld returns null for a run the session has moved on from.
    expect(isWorldListVisible({ id: 99, world_layer: 'subworld' }, null)).toBe(false)
  })
})
