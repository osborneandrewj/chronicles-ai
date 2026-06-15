import 'server-only'

import type { WorldArchetype } from '@/domain/ports/world-archetype-provider'

import { BUNKER } from './bunker'
import { CARAVANSERAI } from './caravanserai'
import { CASTLE_KEEP } from './castle-keep'
import { FEUDAL_VILLAGE } from './feudal-village'
import { MONASTERY } from './monastery'
import { RESEARCH_FACILITY } from './research-facility'
import { ROYAL_COURT } from './royal-court'
import { SCOUT_VESSEL } from './scout-vessel'
import { ZIGGURAT_TEMPLE } from './ziggurat-temple'

// Data-driven archetype registry (Phase B, B2). Adding an archetype is one entry
// here — nothing in the code privileges the ship; it is row 1. Hub archetypes
// (isHub) are eligible for pickHubArchetype() at concealed-onboarding time.
// Genre-coupling audit (Phase 2): the registry now spans non-sci-fi settings
// (feudal village, castle, temple-state, court, caravanserai) so genre-filtered
// hub selection can draw a period-appropriate home base.
const ALL: WorldArchetype[] = [
  SCOUT_VESSEL,
  RESEARCH_FACILITY,
  MONASTERY,
  BUNKER,
  FEUDAL_VILLAGE,
  CASTLE_KEEP,
  ZIGGURAT_TEMPLE,
  ROYAL_COURT,
  CARAVANSERAI,
]

export const WORLD_ARCHETYPES: Map<string, WorldArchetype> = new Map(
  ALL.map((a) => [a.id, a]),
)

export function listWorldArchetypes(): WorldArchetype[] {
  return ALL
}

export function hubArchetypes(): WorldArchetype[] {
  return ALL.filter((a) => a.isHub)
}
