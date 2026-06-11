// Character / Place / Scene row entities. Pure type declarations (spec §3.3).
// These three rows are the spine of authoritative world state; the narrator and
// inspector read them, the archivist writes them.

export type CharacterAgencyLevel = 'npc' | 'local' | 'nearby' | 'distant' | 'dormant'

export type Character = {
  id: number
  world_id: number
  name: string
  description: string | null
  is_player: number
  current_place_id: number | null
  memorable_facts: string | null
  status: 'active' | 'inactive' | 'dead'
  active_goal: string | null
  current_attitude: string | null
  observations: string | null
  agency_level: CharacterAgencyLevel
  personal_goals: string | null
  current_focus: string | null
  recent_activity: string | null
  private_beliefs: string | null
  reveries: string | null
  relationship_to_player: string | null
  long_term_agenda: string | null
  tool_access: string | null
  appearance_count: number
  last_seen_turn_id: number | null
  last_agent_tick_turn_id: number | null
  player_notes: string | null
  in_transit_to_place_id: number | null
  arrival_world_time: string | null
  last_known_situation: string | null
  aliases: string | null
  daily_loop: string | null
  created_at: string
  updated_at: string
}

export type Place = {
  id: number
  world_id: number
  name: string
  description: string | null
  kind: string | null
  deck: string | null
  layout_hint: string | null
  player_notes: string | null
  osm_display_name: string | null
  osm_street: string | null
  osm_neighborhood: string | null
  osm_lat: number | null
  osm_lng: number | null
  geo_status: 'unresolved' | 'ok' | 'not_found' | 'unavailable'
  geo_resolved_at: string | null
  created_at: string
  updated_at: string
}

// place_connections row (v26). The bounded-world room-connectivity graph: a
// directed edge from one place to another. `bidirectional` (1/0) means the edge
// is traversable both ways. `kind`: corridor/hatch/door/ladder/airlock.
export type PlaceConnection = {
  id: number
  world_id: number
  from_place_id: number
  to_place_id: number
  kind: string | null
  bidirectional: number
  created_at: string | null
}

// Plain adjacency over place ids that the pure topology services (deck-graph,
// npc-movement) share. `adjacency[placeId]` lists the place ids reachable in one
// hop. Bidirectional connections contribute an entry on both sides; the service
// that builds the graph from PlaceConnection rows owns that expansion.
export type DeckGraph = {
  adjacency: Record<number, number[]>
}

// character_relationships row (v27). A directed relationship from one character
// to another. `valence` in −1..1 drives deterministic drift + beat gating in the
// pre-sim. `kind`: rival/ally/mentor/romance/superior/subordinate/…
export type CharacterRelationship = {
  id: number
  world_id: number
  from_character_id: number
  to_character_id: number
  kind: string | null
  valence: number
  note: string | null
  updated_at: string | null
}

export type Scene = {
  id: number
  world_id: number
  place_id: number | null
  title: string
  summary: string | null
  scene_number: number
  status: 'active' | 'completed'
  scene_mood: 'atmospheric' | 'tense' | 'violent' | 'intimate' | 'wondrous' | null
  pace: 'slow' | 'medium' | 'fast' | null
  focus: 'environment' | 'characters' | 'action' | 'internal' | null
  opened_at_turn: number | null
  closed_at_turn: number | null
  created_at: string
  updated_at: string
}
