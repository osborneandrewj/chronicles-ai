import type { InitialState } from '@/domain/entities'
import type { SessionRepository, WorldRepository } from '@/domain/ports'
import { createWorld } from '@/application/use-cases/create-world'

// EnterSubworld (Phase C, C3) — seed a loose simulation linked to its hub and
// point the session at it. The simulation is an OPEN world (no authored map; the
// archivist grows places as the player explores) seeded from the chosen genre's
// hidden premise. Real-world geocoding is gated OFF: a historical simulation is
// a fictional interior, so we inject a no-op region extractor rather than let
// "Ancient Rome" resolve to modern coordinates. Pure orchestration over the
// world + session ports; no SQL/SDK/framework here.

export type EnterSubworldInput = {
  hubWorldId: number
  sessionId: number
  // Player-facing world name (a codename under the concealed path).
  name: string
  // The genre preset's hidden premise — seeds the narrator, never surfaced.
  premise: string
  initialState: InitialState
}

export type EnterSubworldResult = {
  subworldId: number
}

export type EnterSubworldDeps = {
  worlds: WorldRepository
  sessions: SessionRepository
}

export async function enterSubworld(
  { hubWorldId, sessionId, name, premise, initialState }: EnterSubworldInput,
  deps: EnterSubworldDeps,
): Promise<EnterSubworldResult> {
  const { sessions, worlds } = deps

  // Loose/open simulation; geocoding disabled (fictional interior).
  const { worldId } = await createWorld(
    { name, premise, initialState },
    { worlds, extractSettingRegion: async () => null },
  )

  await worlds.setLayer(worldId, 'subworld', hubWorldId)
  await sessions.setSubworld(sessionId, worldId)
  await sessions.flip(sessionId, 'in_subworld')

  return { subworldId: worldId }
}
