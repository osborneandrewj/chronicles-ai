// NPC intent entity + visibility/disposition enums (v0.6.9). Pure type
// declarations (spec §3.3). A durable record of an NPC's planned action and how
// the narrator ultimately handled it; written pre-narrator, reconciled after.

export type IntentVisibility = 'public' | 'narrator' | 'npc_private' | 'narrator_blind'
export type IntentDisposition = 'staged' | 'modified' | 'ignored' | 'contradicted'

export type NpcIntentRow = {
  id: number
  world_id: number
  character_id: number
  player_turn_id: number
  narrator_turn_id: number | null
  agency_level: string
  intent_text: string
  planned_action: string
  intent_type: string | null
  target_character_id: number | null
  target_place_id: number | null
  private_rationale: string | null
  expected_visibility: IntentVisibility
  narrator_disposition: IntentDisposition | null
  narrator_interpretation: string | null
  outcome_summary: string | null
  resolved_outcome: string | null
  reconciliation_confidence: number | null
  archived_patch: string | null
  created_at: string
  updated_at: string
}
