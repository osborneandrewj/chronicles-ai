// World entity + new-world initial-state shape. Pure type declarations
// (spec §3.3).

export type SpatialMode = 'open' | 'bounded'

// Phase C (C1) — simulation-hub layering. 'hub' = concealed home base,
// 'subworld' = a historical simulation entered from a hub, 'standalone' = legacy
// open/bounded worlds (the default, unchanged).
export type WorldLayer = 'hub' | 'subworld' | 'standalone'

export type World = {
  id: number
  name: string
  premise: string
  initial_state_json: string
  setting_region: string | null
  spatial_mode: SpatialMode
  template_id: string | null
  // Prose-driven ship-clock (starship P6): minutes since a Day-1 00:00 baseline.
  // Set for bounded worlds; null for open worlds (which keep current_time).
  ship_clock_minutes: number | null
  // Simulation-hub layering (C1). `parent_world_id` links a subworld to its hub;
  // `meta_story_json` is the hub-only Meta-Story Bible (generated, never rendered).
  world_layer: WorldLayer
  parent_world_id: number | null
  meta_story_json: string | null
  created_at: string
}

export type WorldSummary = {
  id: number
  name: string
  premise: string
  created_at: string
  archived_at: string | null
  turn_count: number
  // Simulation-hub layer (v0.2.1) — lets the home list decide what to show per
  // playthrough (the active simulation while concealed, the hub once revealed).
  world_layer: WorldLayer
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
