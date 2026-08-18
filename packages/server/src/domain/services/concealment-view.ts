import type { SimulationSession, WorldLayer } from '@/domain/entities'

// Pure domain service (Phase C, C7; Animus visibility pass) — what a read
// surface may expose. The Animus (hub) is a named, player-facing world type,
// so it is never hidden. The Meta-Story Bible is still never rendered (that
// lives in meta_story_json and is not part of this gate). The rich hidden
// premise of a first life is still scrubbed from list/inspector payloads
// while the player is inside that life. No I/O.

export type ConcealmentView = {
  // True while the player is inside a first life (session in_subworld).
  concealed: boolean
  // Must this world be hidden from every read surface right now?
  // Always false: the Animus is named.
  hideWorld: boolean
  // Must this world's premise be scrubbed from any payload right now?
  hidePremise: boolean
}

export function concealmentView(
  session: SimulationSession | null,
  world: { id: number; world_layer: WorldLayer },
): ConcealmentView {
  const inLife = session !== null && session.status === 'in_subworld'
  if (!inLife) {
    return { concealed: false, hideWorld: false, hidePremise: false }
  }
  const isSubworld =
    world.world_layer === 'subworld' ||
    (session !== null && world.id === session.subworld_world_id)
  return { concealed: true, hideWorld: false, hidePremise: isSubworld }
}
