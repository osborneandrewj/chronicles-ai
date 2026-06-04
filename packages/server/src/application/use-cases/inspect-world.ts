import type { WorldRepository } from '@/domain/ports'
import { WorldNotFoundError } from '@/application/use-cases/load-history'

// InspectWorld (spec §3.5, §5.1-P5) — read projection for the world inspector.
// Orchestration only: gate on world existence through the WorldRepository port,
// then run the injected read projection. The full server-side move of the
// projection itself (badge / profile / [t:N] derivation, which still owns SQL in
// `lib/world-state.ts`) is P6 — so the projection is passed in as a function the
// route wires, keeping `application/` free of lib/SQL imports.

export { WorldNotFoundError }

export type InspectWorldInput = {
  worldId: number
}

export type InspectWorldDeps<TProjection> = {
  worlds: WorldRepository
  project: (worldId: number) => TProjection | Promise<TProjection>
}

export async function inspectWorld<TProjection>(
  { worldId }: InspectWorldInput,
  { worlds, project }: InspectWorldDeps<TProjection>,
): Promise<TProjection> {
  if (!(await worlds.getWorld(worldId))) {
    throw new WorldNotFoundError(worldId)
  }
  return project(worldId)
}
