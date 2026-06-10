import type { SimulationSession, WorldLayer } from '@/domain/entities'

// Pure domain service (Phase C, C7) — the concealment gate. The simulation-hub
// reveal must not be spoiled by ANY read surface (join UI, world list, world
// title, the inspector, route JSON) — even for test users — until the in-fiction
// awakening flips `has_awoken`. This decides, server-side, what a given world may
// expose right now, so concealment is enforced at the query/use-case layer and
// no view can leak it. No I/O.
//
// While a session is concealed (in a subworld, not yet awoken):
//   - the HUB world is hidden entirely (not inspectable, not listed);
//   - any premise is scrubbed from payloads (the rich hidden premise lives only
//     in narrator/archivist context, never in a client view).
// Once `has_awoken` is true (or there is no session — a standalone world), the
// gate relaxes and everything is visible.

export type ConcealmentView = {
  // Is the playthrough currently concealed?
  concealed: boolean
  // Must this world be hidden from every read surface right now?
  hideWorld: boolean
  // Must this world's premise be scrubbed from any payload right now?
  hidePremise: boolean
}

export function concealmentView(
  session: SimulationSession | null,
  world: { id: number; world_layer: WorldLayer },
): ConcealmentView {
  const concealed = session !== null && session.has_awoken === 0 && session.status === 'in_subworld'
  if (!concealed) {
    return { concealed: false, hideWorld: false, hidePremise: false }
  }
  const isHub = world.world_layer === 'hub' || (session !== null && world.id === session.hub_world_id)
  return { concealed: true, hideWorld: isHub, hidePremise: true }
}
