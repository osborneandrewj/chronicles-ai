import type { SimulationSession, WorldLayer } from '@/domain/entities'

// Pure domain service (v0.2.1, Item 2) — should a world appear as a top-level
// entry on the home list? The goal is ONE entry per playthrough: the active
// simulation while the hub is still concealed, and the hub itself once the
// player has awoken (simulations then move into the hub's read-only archive).
// Standalone worlds always show. No I/O.
//
// `session` is the session that world participates in (sessions.byWorld(id)) —
// null for a standalone world or a simulation the session no longer points at
// (a past run, reachable only from the hub archive).

export function isWorldListVisible(
  world: { id: number; world_layer: WorldLayer },
  session: SimulationSession | null,
): boolean {
  if (world.world_layer === 'standalone') return true
  if (world.world_layer === 'hub') {
    // The hub is concealed until the in-fiction awakening.
    return session !== null && session.has_awoken === 1
  }
  // subworld: a top-level entry only while it is the active, not-yet-awoken
  // simulation; afterwards it lives in the hub's archive, not the home list.
  return (
    session !== null &&
    session.has_awoken === 0 &&
    session.status === 'in_subworld' &&
    session.subworld_world_id === world.id
  )
}
