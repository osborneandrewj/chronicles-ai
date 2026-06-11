import { seedBoundedWorld } from '@/application/use-cases/seed-bounded-world'
import type { SeedBoundedWorldDeps } from '@/application/use-cases/seed-bounded-world'
import { simulateWorldForward } from '@/application/use-cases/simulate-world-forward'
import type { SimulateWorldForwardDeps } from '@/application/use-cases/simulate-world-forward'
import type { SceneRepository } from '@/domain/ports'
import { worldTimeToMinutes } from '@/domain/services/narrative-clock'

// CreateBoundedWorld (Phase B, B5) — pure orchestration that makes a bounded
// world both creatable and playable in one synchronous flow: seed the authored
// archetype (real Grok ensemble in prod) → run the player-less forward sim (real
// Haiku beats) → drop the player into the archetype's entry room as a newcomer →
// open Scene 1 there → point the world cursor at it. Every player-visible string
// (the entry room, the scene title, the protagonist label/intro) comes from the
// archetype, not a hardcoded ship — nothing here is starship-specific. The
// world's `name` is the caller-supplied player-facing label (a codename under
// the concealed path); the rich premise seeds the narrator but is not surfaced.

// Default number of pre-sim ticks (~one band each) the world lives before the
// player arrives — enough motion to feel alive, small enough to stay in budget.
const SIM_TICKS = 12

export type CreateBoundedWorldInput = {
  templateId: string
  name: string
  premise: string
  playerName?: string
  ticks?: number
}

export type CreateBoundedWorldResult = {
  worldId: number
  sceneId: number
  playerId: number
}

export type CreateBoundedWorldDeps = SeedBoundedWorldDeps &
  SimulateWorldForwardDeps & {
    scenes: SceneRepository
  }

export async function createBoundedWorld(
  { templateId, name, premise, playerName, ticks }: CreateBoundedWorldInput,
  deps: CreateBoundedWorldDeps,
): Promise<CreateBoundedWorldResult> {
  const { characters, decks, scenes, worlds } = deps

  const archetype = await decks.getTemplate(templateId)

  const seeded = await seedBoundedWorld({ templateId, name, premise, playerName }, deps)
  await simulateWorldForward({ worldId: seeded.worldId, ticks: ticks ?? SIM_TICKS }, deps)

  // Seed the prose-driven narrative clock from the pre-play sim's final
  // world_time, so the arrival clock is anchored to the moment the ensemble are
  // positioned for. During play, narrate-turn advances this counter per beat.
  const { world_time: boardingWorldTime } = await worlds.cursor(seeded.worldId)
  await worlds.setShipClockMinutes(seeded.worldId, worldTimeToMinutes(boardingWorldTime))

  // The entry room comes from the archetype (entryLocationKey), resolved to its
  // seeded place id by position in the archetype's room list; fall back to the
  // first seeded room when unspecified. No ship-specific assumption.
  const entryIndex = resolveEntryIndex(archetype?.rooms.map((r) => r.key), archetype?.entryLocationKey)
  const entryPlaceId = seeded.placeIds[entryIndex] ?? seeded.placeIds[0]

  const label = playerName?.trim() || archetype?.defaultCharacterLabel || 'You'
  const intro = archetype?.playerIntroTemplate ?? 'a newcomer, just arrived — name not yet established'

  const player = await characters.add({
    world_id: seeded.worldId,
    name: label,
    description: `A newcomer: ${intro}.`,
    is_player: 1,
    current_place_id: entryPlaceId,
    role: null,
    active_goal: null,
    daily_loop: null,
  })

  const scene = await scenes.add({
    world_id: seeded.worldId,
    place_id: entryPlaceId,
    title: archetype?.initialSceneTitle ?? 'Arrival',
    scene_number: 1,
    status: 'active',
  })

  await worlds.setCursor(seeded.worldId, scene.id)

  return { worldId: seeded.worldId, sceneId: scene.id, playerId: player.id }
}

function resolveEntryIndex(roomKeys: string[] | undefined, entryKey: string | undefined): number {
  if (!roomKeys || !entryKey) return 0
  const idx = roomKeys.indexOf(entryKey)
  return idx >= 0 ? idx : 0
}
