import type {
  InsertNpcIntent,
  IntentDisposition,
  NpcIntentRow,
  ReconcileIntentInput,
} from '@/lib/npc-intents'

export type ReconcileBatchResult = {
  intentId: number
  narratorTurnId: number
  disposition: IntentDisposition
  interpretation?: string | null
  outcomeSummary?: string | null
  resolvedOutcome?: string | null
  confidence?: number | null
}

// NpcIntentRepository (spec §3.4) — dumb CRUD over `npc_intents`. Reconciliation
// *decisions* (staged/modified/ignored/contradicted) are produced by the
// reconciler domain service; this port only persists the chosen rows. Async by
// mandate (spec §5.3).
export interface NpcIntentRepository {
  insert(input: InsertNpcIntent): Promise<number>
  forPlayerTurn(playerTurnId: number): Promise<NpcIntentRow[]>
  recentOutcomesForCharacter(characterId: number, limit: number): Promise<NpcIntentRow[]>
  setNarratorTurn(intentId: number, narratorTurnId: number): Promise<void>
  reconcile(input: ReconcileIntentInput): Promise<void>
  reconcileBatch(results: ReconcileBatchResult[]): Promise<void>
  attachToNarratorTurn(intentIds: number[], narratorTurnId: number): Promise<void>
}
