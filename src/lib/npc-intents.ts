import { db } from '@/lib/db'

// v0.6.9 — durable record of NPC plans and how the narrator handled them.
// Insert is split from the agent call so npc-agent.ts can persist before the
// narrator runs and the post-narrator reconciliation step can update the same
// row with the narrator turn id, a disposition label, and an interpretation.

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

export type InsertNpcIntent = {
  worldId: number
  characterId: number
  playerTurnId: number
  agencyLevel: string
  intentText: string
  plannedAction: string
  intentType?: string | null
  targetCharacterId?: number | null
  targetPlaceId?: number | null
  privateRationale?: string | null
  expectedVisibility?: IntentVisibility
}

const insertIntentStmt = db.prepare<
  [
    number,
    number,
    number,
    string,
    string,
    string,
    string | null,
    number | null,
    number | null,
    string | null,
    IntentVisibility,
  ]
>(
  `INSERT INTO npc_intents (
     world_id, character_id, player_turn_id, agency_level,
     intent_text, planned_action, intent_type,
     target_character_id, target_place_id, private_rationale, expected_visibility
   )
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   RETURNING id`,
)

export function insertNpcIntent(input: InsertNpcIntent): number {
  const row = insertIntentStmt.get(
    input.worldId,
    input.characterId,
    input.playerTurnId,
    input.agencyLevel,
    input.intentText,
    input.plannedAction,
    input.intentType ?? null,
    input.targetCharacterId ?? null,
    input.targetPlaceId ?? null,
    input.privateRationale ?? null,
    input.expectedVisibility ?? 'narrator',
  ) as { id: number }
  return row.id
}

const intentsForPlayerTurnStmt = db.prepare<[number]>(
  `SELECT id, world_id, character_id, player_turn_id, narrator_turn_id, agency_level,
          intent_text, planned_action, intent_type, target_character_id, target_place_id,
          private_rationale, expected_visibility, narrator_disposition,
          narrator_interpretation, outcome_summary, resolved_outcome,
          reconciliation_confidence, archived_patch, created_at, updated_at
   FROM npc_intents
   WHERE player_turn_id = ?
   ORDER BY id ASC`,
)

export function getIntentsForPlayerTurn(playerTurnId: number): NpcIntentRow[] {
  return intentsForPlayerTurnStmt.all(playerTurnId) as NpcIntentRow[]
}

const recentIntentOutcomesForCharacterStmt = db.prepare<[number, number]>(
  `SELECT id, world_id, character_id, player_turn_id, narrator_turn_id, agency_level,
          intent_text, planned_action, intent_type, target_character_id, target_place_id,
          private_rationale, expected_visibility, narrator_disposition,
          narrator_interpretation, outcome_summary, resolved_outcome,
          reconciliation_confidence, archived_patch, created_at, updated_at
   FROM npc_intents
   WHERE character_id = ?
     AND narrator_disposition IS NOT NULL
   ORDER BY id DESC
   LIMIT ?`,
)

// Recent reconciled intents for an NPC, newest first. Used to feed the next
// agent tick so it can react when the narrator keeps modifying or ignoring
// its plans. Unreconciled rows (still pending) are skipped — without a label
// they would only add noise.
export function getRecentIntentOutcomesForCharacter(
  characterId: number,
  limit: number,
): NpcIntentRow[] {
  return recentIntentOutcomesForCharacterStmt.all(
    characterId,
    Math.max(1, Math.min(20, limit)),
  ) as NpcIntentRow[]
}

const setNarratorTurnStmt = db.prepare<[number, number]>(
  `UPDATE npc_intents
   SET narrator_turn_id = ?, updated_at = datetime('now')
   WHERE id = ?`,
)

export function setIntentNarratorTurn(intentId: number, narratorTurnId: number): void {
  setNarratorTurnStmt.run(narratorTurnId, intentId)
}

const reconcileIntentStmt = db.prepare<
  [
    number,
    IntentDisposition,
    string | null,
    string | null,
    string | null,
    number | null,
    number,
  ]
>(
  `UPDATE npc_intents
   SET narrator_turn_id = ?,
       narrator_disposition = ?,
       narrator_interpretation = ?,
       outcome_summary = ?,
       resolved_outcome = ?,
       reconciliation_confidence = ?,
       updated_at = datetime('now')
   WHERE id = ?`,
)

export type ReconcileIntentInput = {
  intentId: number
  narratorTurnId: number
  disposition: IntentDisposition
  interpretation?: string | null
  outcomeSummary?: string | null
  resolvedOutcome?: string | null
  confidence?: number | null
}

export function reconcileIntent(input: ReconcileIntentInput): void {
  reconcileIntentStmt.run(
    input.narratorTurnId,
    input.disposition,
    input.interpretation ?? null,
    input.outcomeSummary ?? null,
    input.resolvedOutcome ?? null,
    input.confidence ?? null,
    input.intentId,
  )
}

// Update all rows the post-narrator reconciler decided on in one transaction.
// Reconciliation either runs as a batch or not at all — if the helper LLM
// errors, the rows stay with narrator_turn_id set but disposition null, which
// is the documented "pending" shape that future ticks can detect.
export function reconcileIntentsBatch(
  results: Array<{
    intentId: number
    narratorTurnId: number
    disposition: IntentDisposition
    interpretation?: string | null
    outcomeSummary?: string | null
    resolvedOutcome?: string | null
    confidence?: number | null
  }>,
): void {
  if (results.length === 0) return
  const tx = db.transaction(() => {
    for (const r of results) reconcileIntent(r)
  })
  tx()
}

export function attachIntentsToNarratorTurn(
  intentIds: number[],
  narratorTurnId: number,
): void {
  if (intentIds.length === 0) return
  const tx = db.transaction(() => {
    for (const id of intentIds) setNarratorTurnStmt.run(narratorTurnId, id)
  })
  tx()
}
