import { seedBoundedWorld } from '@/application/use-cases/seed-bounded-world'
import type { SeedBoundedWorldDeps } from '@/application/use-cases/seed-bounded-world'
import { simulateWorldForward } from '@/application/use-cases/simulate-world-forward'
import type { SimulateWorldForwardDeps } from '@/application/use-cases/simulate-world-forward'
import type { SceneRepository } from '@/domain/ports'

// CreateStarshipWorld (starship P4a) — pure orchestration that makes a bounded
// starship world both creatable and playable in one synchronous flow: seed the
// authored ship (real Grok crew in prod) → run the player-less forward sim
// (real Haiku beats) → drop the player aboard as a newcomer on the Bridge → open
// Scene 1 there → point the world cursor at it. It composes the existing
// SeedBoundedWorld + SimulateWorldForward use cases and the scene/cursor write
// ports; every store/LLM seam is an injected port, so there is no SQL, SDK, lib,
// or framework here. Mapping a thrown error to the join UI is an adapter concern.

// Default number of pre-sim ticks (~one band each) the world lives before the
// player boards — enough motion to feel alive, small enough to stay in budget.
const SIM_TICKS = 12

export type CreateStarshipWorldInput = {
  templateId: string
  name: string
  premise: string
  playerName?: string
  ticks?: number
}

export type CreateStarshipWorldResult = {
  worldId: number
  sceneId: number
  playerId: number
}

// Everything the seed + sim use cases need, plus the scene writer. The player is
// added through the same `characters` port the seeder already carries, and the
// cursor is set through the same `worlds` port; the only new dependency is
// `scenes` (the SceneRepository) to open the arrival scene.
export type CreateStarshipWorldDeps = SeedBoundedWorldDeps &
  SimulateWorldForwardDeps & {
    scenes: SceneRepository
  }

export async function createStarshipWorld(
  { templateId, name, premise, playerName, ticks }: CreateStarshipWorldInput,
  deps: CreateStarshipWorldDeps,
): Promise<CreateStarshipWorldResult> {
  const { characters, scenes, worlds } = deps

  const seeded = await seedBoundedWorld({ templateId, name, premise, playerName }, deps)
  await simulateWorldForward({ worldId: seeded.worldId, ticks: ticks ?? SIM_TICKS }, deps)

  // The scout template's first room is the Bridge, so placeIds[0] is the Bridge
  // place id — the entry room the boarding player lands in.
  const bridgePlaceId = seeded.placeIds[0]

  const player = await characters.add({
    world_id: seeded.worldId,
    name: playerName?.trim() || 'Newcomer',
    description: 'A newcomer just come aboard — name not yet established.',
    is_player: 1,
    current_place_id: bridgePlaceId,
    role: null,
    active_goal: null,
    daily_loop: null,
  })

  const scene = await scenes.add({
    world_id: seeded.worldId,
    place_id: bridgePlaceId,
    title: 'Arrival',
    scene_number: 1,
    status: 'active',
  })

  await worlds.setCursor(seeded.worldId, scene.id)

  return { worldId: seeded.worldId, sceneId: scene.id, playerId: player.id }
}
