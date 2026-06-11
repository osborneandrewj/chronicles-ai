import type { SessionRepository, WorldRepository } from '@/domain/ports'
import { WorldNotFoundError } from '@/application/use-cases/load-history'
import { concealmentView } from '@/domain/services/concealment-view'

// InspectWorld (spec §3.5, §5.1-P5) — read projection for the world inspector.
// Orchestration only: gate on world existence through the WorldRepository port,
// then run the injected read projection. The full server-side move of the
// projection itself (badge / profile / [t:N] derivation, which still owns SQL in
// `lib/world-state.ts`) is P6 — so the projection is passed in as a function the
// route wires, keeping `application/` free of lib/SQL imports.
//
// Concealment (C7): while a playthrough is concealed (in a subworld, not yet
// awoken) the HUB is not inspectable — even for test users. We treat an attempt
// to inspect the concealed hub as a not-found, indistinguishable from a missing
// world, so no surface can confirm the hub exists before the awakening.

export { WorldNotFoundError }

export type InspectWorldInput = {
  worldId: number
}

export type InspectWorldDeps<TProjection> = {
  worlds: WorldRepository
  sessions: SessionRepository
  project: (worldId: number) => TProjection | Promise<TProjection>
}

export async function inspectWorld<TProjection>(
  { worldId }: InspectWorldInput,
  { worlds, sessions, project }: InspectWorldDeps<TProjection>,
): Promise<TProjection> {
  const world = await worlds.getWorld(worldId)
  if (!world) {
    throw new WorldNotFoundError(worldId)
  }
  const session = await sessions.byWorld(worldId)
  if (concealmentView(session, world).hideWorld) {
    throw new WorldNotFoundError(worldId)
  }
  return project(worldId)
}
