import type { InitialState } from '@/domain/entities'
import type { WorldRepository } from '@/domain/ports'

// CreateWorld (P3 cutover) — pure orchestration that turns a player's premise +
// initial state into a seeded, region-anchored OPEN world. It seeds the world
// (worlds row + starting place/player/Scene 1 + cursor) through the WorldRepository
// port, then extracts a Nominatim-friendly setting region from the premise and
// writes it back through the same port. No SQL, no SDK, no lib, no framework: the
// store seam is the injected `worlds` port and the LLM seam is the injected
// `extractSettingRegion` function (the route wires the concrete region extractor).
// Region extraction failing must never sink world creation, so it is best-effort.

export type CreateWorldInput = {
  name: string
  premise: string
  initialState: InitialState
}

export type CreateWorldResult = {
  worldId: number
}

export type CreateWorldDeps = {
  worlds: WorldRepository
  extractSettingRegion: (
    premise: string,
    initialLocation: string | null,
  ) => Promise<string | null>
}

export async function createWorld(
  { name, premise, initialState }: CreateWorldInput,
  deps: CreateWorldDeps,
): Promise<CreateWorldResult> {
  const { extractSettingRegion, worlds } = deps

  const { id: worldId } = await worlds.createOpen({ name, premise, initialState })

  const region = await extractSettingRegion(premise, initialState.location)
  if (region) await worlds.setSettingRegion(worldId, region)

  return { worldId }
}
