// Reverie entity + the input/flare-candidate value shapes (v0.6.x living-NPC
// substrate). Pure type declarations (spec §3.3). `match_tags` is hydrated from
// the stored JSON into a string[] by the repository.

export type ReverieRow = {
  id: number
  world_id: number
  character_id: number
  text: string
  match_tags: string[]
  intensity: number
  is_cornerstone: number
  created_turn_id: number | null
  last_flared_turn_id: number | null
  created_at: string
}

export type ReverieInput = {
  text: string
  match_tags?: string[]
  intensity?: number
}

export type FlareCandidate = {
  id: number
  character_id: number
  match_tags: string[]
  intensity: number
}
