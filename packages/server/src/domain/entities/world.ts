// World entity + new-world initial-state shape. Pure type declarations
// (spec §3.3).

export type SpatialMode = 'open' | 'bounded'

export type World = {
  id: number
  name: string
  premise: string
  initial_state_json: string
  setting_region: string | null
  spatial_mode: SpatialMode
  template_id: string | null
  created_at: string
}

export type WorldSummary = {
  id: number
  name: string
  premise: string
  created_at: string
  archived_at: string | null
  turn_count: number
}

// Initial-state shape supplied by the new-world form. After v0.5 this still
// seeds the first character/place/scene rows; the legacy initial_state_json
// column is also written for audit and as a fallback for any future migration.
export type InitialState = {
  time: string
  location: string
  identity: string
  playerName?: string
}
