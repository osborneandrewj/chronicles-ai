import 'server-only'

import type { WorldArchetype } from '@/domain/ports/world-archetype-provider'

import { BUNKER } from './bunker'
import { MONASTERY } from './monastery'
import { RESEARCH_FACILITY } from './research-facility'
import { SCOUT_VESSEL } from './scout-vessel'

// Data-driven archetype registry (Phase B, B2). Adding an archetype is one entry
// here — nothing in the code privileges the ship; it is row 1. Hub archetypes
// (isHub) are eligible for pickHubArchetype() at concealed-onboarding time.
const ALL: WorldArchetype[] = [SCOUT_VESSEL, RESEARCH_FACILITY, MONASTERY, BUNKER]

export const WORLD_ARCHETYPES: Map<string, WorldArchetype> = new Map(
  ALL.map((a) => [a.id, a]),
)

export function listWorldArchetypes(): WorldArchetype[] {
  return ALL
}

export function hubArchetypes(): WorldArchetype[] {
  return ALL.filter((a) => a.isHub)
}
