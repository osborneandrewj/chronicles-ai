import type { CharacterRelationship } from '@/domain/entities'

// DramaPort (starship P0; the roadmap's `LlmDramaPort`) — the only LLM seam in
// the pre-sim. Given a co-located group of NPCs plus their relationships and
// active threads, it produces ONE short, structured beat (a compact event
// summary, NOT full generated dialogue — per the "compact persistence" decision).
// Beat-gating (tension + cooldown) is a pure domain service that decides WHETHER
// to spend a beat; this port only generates one when authorized. Haiku-backed in
// infrastructure; this is the interface only.

// A participant the drama call reasons over. Kept minimal + structured so the
// adapter builds the prompt and the domain stays free of prose. `goal` is the
// NPC's current driver; `place` is where the group is co-located.
export type DramaParticipant = {
  character_id: number
  name: string
  role: string | null
  goal: string | null
}

export type DramaBeatInput = {
  world_id: number
  sim_tick: number
  world_time: string | null
  place_id: number
  place_name: string
  participants: DramaParticipant[]
  relationships: CharacterRelationship[]
  threads: string[]
  // The last few ship-wide beats as 'title: summary', most-recent-last, so the
  // generator can advance the situation instead of repeating a prior conflict.
  recentBeats: string[]
}

// A valence delta the beat suggests, to be applied by the relationship-drift
// service (the domain decides clamping; the beat only proposes).
export type DramaValenceDelta = {
  from_character_id: number
  to_character_id: number
  delta: number
}

// The structured beat. `title` / `summary` map to a timeline_events row written
// with provenance='sim'; `valenceDeltas` feed relationship drift.
export type DramaBeat = {
  title: string
  summary: string
  participant_ids: number[]
  valenceDeltas: DramaValenceDelta[]
}

export interface DramaPort {
  generateBeat(input: DramaBeatInput): Promise<DramaBeat>
}
