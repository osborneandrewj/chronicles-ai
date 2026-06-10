// EnsembleGenerator port (starship P1) — the Grok dressing seam. Given an authored
// deck-plan template + the world premise, it produces the *content* the seeder
// writes onto the fixed topology: a ship name, per-room descriptive dressing,
// 3–5 crew members (each with a persona, goal, home room, and a time-banded
// daily loop), and an initial relationship graph keyed by crew role. The port is
// a pure domain interface; the adapter owns the LLM call + Zod validation, and a
// deterministic stub backs tests + the offline seed script.
//
// Invariants the adapter must enforce before returning (validated downstream too):
//   - crew length is 3–5
//   - every relationship.valence is in −1..1
//   - homeRoomKey and every dailyLoop[band].place reference a real template room
//     (key for homeRoomKey; key or display name for dailyLoop place)
//   - relationship fromRole/toRole reference generated crew roles

import type { WorldArchetype } from '@/domain/ports/world-archetype-provider'
import type { WorldTimeBand } from '@/domain/services/world-clock'

export type EnsembleGeneratorInput = {
  template: WorldArchetype
  premise: string
  playerName?: string
}

// One room of a crew member's routine: what they do in a given time band and the
// room it happens in. `place` references a template room (key or display name);
// the seeder snaps it to a real place id.
export type CompanionDailyLoopEntry = {
  activity: string
  place: string
}

export type GeneratedCompanion = {
  role: string
  name: string
  persona: string
  goal: string
  homeRoomKey: string
  dailyLoop: Record<WorldTimeBand, CompanionDailyLoopEntry>
}

export type GeneratedRelationship = {
  fromRole: string
  toRole: string
  kind: string
  valence: number
}

export type GeneratedRoomDressing = {
  key: string
  description: string
}

export type GeneratedEnsemble = {
  shipName: string
  premise: string
  roomDressing: GeneratedRoomDressing[]
  crew: GeneratedCompanion[]
  relationships: GeneratedRelationship[]
}

export interface EnsembleGenerator {
  generate(input: EnsembleGeneratorInput): Promise<GeneratedEnsemble>
}
