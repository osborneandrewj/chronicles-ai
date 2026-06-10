import type { SimulationSession } from '@/domain/entities'

// Pure domain service (Phase C, C4) — resolve the world the player is actually
// in from a session. The route may hold a stable URL world id (the hub or a
// subworld); the active world is the subworld while playing a simulation and the
// hub once the player has surfaced. A standalone world (no session) resolves to
// itself. advanceTurn stays world-id-driven; this only picks which id to feed it.

export function resolveActiveWorldId(
  urlWorldId: number,
  session: SimulationSession | null,
): number {
  if (!session) return urlWorldId
  if (session.status === 'in_subworld' && session.subworld_world_id != null) {
    return session.subworld_world_id
  }
  return session.hub_world_id
}
