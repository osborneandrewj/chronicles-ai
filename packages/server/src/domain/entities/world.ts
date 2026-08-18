// World entity + new-world initial-state shape. Pure type declarations
// (spec §3.3).

export type SpatialMode = 'open' | 'bounded'

// Phase C (C1) — simulation-hub layering. 'hub' = concealed home base,
// 'subworld' = a historical simulation entered from a hub, 'standalone' = legacy
// open/bounded worlds (the default, unchanged).
export type WorldLayer = 'hub' | 'subworld' | 'standalone'

// Play-chrome identity. Persisted on the world so a sci-fi Animus and a Roman
// first life can look different. Null on legacy rows — resolve at read time
// from genre_tags (domain/services/ui-skin.ts).
export type UiSkin = 'signal' | 'relic'

export type World = {
  id: number
  name: string
  premise: string
  initial_state_json: string
  setting_region: string | null
  spatial_mode: SpatialMode
  template_id: string | null
  // Internal narrative clock (minutes since a Day-1 00:00 baseline). Nullable
  // until first advance/backfill. Bounded worlds use it for ship simulation;
  // open/subworlds use it for narrative deadlines. Column name is historical
  // (`ship_clock_minutes`); the invariant is any-world minutes, not ship-only.
  ship_clock_minutes: number | null
  // Simulation-hub layering (C1). `parent_world_id` links a subworld to its hub;
  // `meta_story_json` is the hub-only Meta-Story Bible (generated, never rendered).
  world_layer: WorldLayer
  parent_world_id: number | null
  meta_story_json: string | null
  // Genre signal (genre-coupling audit): JSON string array of era/tone tags
  // captured at creation (e.g. '["roman","ancient","political"]'); null when no
  // genre was declared. Consumers treat null as "no signal" (current behavior).
  genre_tags: string | null
  // Play-chrome skin. Null on pre-v40 rows; resolveUiSkin infers from genre_tags.
  ui_skin: UiSkin | null
  // Hub ops: compact PlayerModel JSON (antagonist intel). Null until first debrief.
  player_model_json: string | null
  // Hub ops: linked antagonist character id on this hub world.
  antagonist_character_id: number | null
  // Subworld ops: InfluencePacket JSON seeded at enter. Null when none.
  influence_packet_json: string | null
  // Gated director brain memory (pending beat for next turn).
  director_state_json: string | null
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
