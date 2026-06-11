// Occupancy / place-profile / population-template row entities + the simulated
// occupancy value shapes (groups, encounter hooks). Pure type declarations
// (spec §3.3). The occupancy *simulation* is a pure domain service; these are
// its persisted inputs and outputs.

export type PlaceProfileRow = {
  id: number
  world_id: number
  place_id: number
  profile_kind: string
  capacity_min: number
  capacity_max: number
  typical_roles_json: string
  open_hours_json: string | null
  traffic_level: 'none' | 'low' | 'medium' | 'high' | 'surge'
  ambience_tags_json: string
  match_tags_json: string
  encounter_rules_json: string
  created_at: string
  updated_at: string
}

export type PopulationTemplateRow = {
  id: number
  world_id: number
  place_profile_kind: string | null
  role: string
  label: string
  description: string | null
  behavior_tags_json: string
  match_tags_json: string
  seed_premise: string | null
  promotable: number
  weight: number
  created_at: string
  updated_at: string
}

export type OccupancySnapshotRow = {
  id: number
  world_id: number
  place_id: number
  scene_id: number | null
  source_turn_id: number | null
  world_time: string | null
  occupancy_json: string
  created_at: string
}
