import 'server-only'

import {
  attachIntentsToNarratorTurn,
  getIntentsForPlayerTurn,
  getRecentIntentOutcomesForCharacter,
  insertNpcIntent,
  reconcileIntent,
  reconcileIntentsBatch,
  setIntentNarratorTurn,
  type InsertNpcIntent,
  type NpcIntentRow,
  type ReconcileIntentInput,
} from '@/lib/npc-intents'
import type {
  NpcIntentRepository,
  ReconcileBatchResult,
} from '@/domain/ports/npc-intent-repository'

// SQLite adapter for NpcIntentRepository (spec §5.1-P1). Delegates to the
// persistence functions in `npc-intents.ts`. The reconciliation *decisions* are
// produced by the reconciler domain service; this adapter only persists rows.
export class SqliteNpcIntentRepository implements NpcIntentRepository {
  insert(input: InsertNpcIntent): Promise<number> {
    return Promise.resolve(insertNpcIntent(input))
  }

  forPlayerTurn(playerTurnId: number): Promise<NpcIntentRow[]> {
    return Promise.resolve(getIntentsForPlayerTurn(playerTurnId))
  }

  recentOutcomesForCharacter(characterId: number, limit: number): Promise<NpcIntentRow[]> {
    return Promise.resolve(getRecentIntentOutcomesForCharacter(characterId, limit))
  }

  setNarratorTurn(intentId: number, narratorTurnId: number): Promise<void> {
    setIntentNarratorTurn(intentId, narratorTurnId)
    return Promise.resolve()
  }

  reconcile(input: ReconcileIntentInput): Promise<void> {
    reconcileIntent(input)
    return Promise.resolve()
  }

  reconcileBatch(results: ReconcileBatchResult[]): Promise<void> {
    reconcileIntentsBatch(results)
    return Promise.resolve()
  }

  attachToNarratorTurn(intentIds: number[], narratorTurnId: number): Promise<void> {
    attachIntentsToNarratorTurn(intentIds, narratorTurnId)
    return Promise.resolve()
  }
}
