import type { SimulationSession, WorldLayer } from '@/domain/entities'

// Pure domain service (v0.2.1, Item 2; Animus visibility pass) — should a
// world appear as a top-level entry on the home list? One entry per
// playthrough: the Animus (hub) is always the card; first lives / past
// simulations live under that card, not as siblings. Standalone worlds
// always show. `session` is unused for the hub/standalone decision but kept
// so existing callers do not change. No I/O.

export function isWorldListVisible(
  world: { id: number; world_layer: WorldLayer },
  session: SimulationSession | null,
): boolean {
  void session
  if (world.world_layer === 'standalone') return true
  if (world.world_layer === 'hub') return true
  return false
}
