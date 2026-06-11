import 'server-only'

import type {
  InsertNpcIntent,
  NpcIntentRow,
  ReconcileIntentInput,
} from '@/lib/npc-intents'
import type {
  NpcIntentRepository,
  ReconcileBatchResult,
} from '@/domain/ports/npc-intent-repository'

import type { MongoContext } from '../mongo-context'
import { mapNpcIntent } from './mappers'

// Mongo NpcIntentRepository (spec §4.2) — dumb CRUD over the `npc_intents`
// durable plan ledger. Reconciliation DECISIONS come from the reconciler domain
// service; this port only persists the chosen rows. Reconcile batches use the
// active UnitOfWork session so the batch commits atomically (mirrors the SQLite
// `db.transaction` wrapper).
export class MongoNpcIntentRepository implements NpcIntentRepository {
  constructor(private readonly ctx: MongoContext) {}

  private get session() {
    return this.ctx.currentSession ?? undefined
  }

  async insert(input: InsertNpcIntent): Promise<number> {
    const id = await this.ctx.nextSeq('npcIntentId')
    const now = new Date()
    await this.ctx.models.NpcIntent.create(
      [
        {
          id,
          worldId: input.worldId,
          characterId: input.characterId,
          playerTurnId: input.playerTurnId,
          narratorTurnId: null,
          agencyLevel: input.agencyLevel,
          intentText: input.intentText,
          plannedAction: input.plannedAction,
          intentType: input.intentType ?? null,
          targetCharacterId: input.targetCharacterId ?? null,
          targetPlaceId: input.targetPlaceId ?? null,
          privateRationale: input.privateRationale ?? null,
          expectedVisibility: input.expectedVisibility ?? 'narrator',
          narratorDisposition: null,
          narratorInterpretation: null,
          outcomeSummary: null,
          resolvedOutcome: null,
          reconciliationConfidence: null,
          archivedPatch: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      { session: this.session },
    )
    return id
  }

  async forPlayerTurn(playerTurnId: number): Promise<NpcIntentRow[]> {
    const docs = await this.ctx.models.NpcIntent.find({ playerTurnId })
      .sort({ id: 1 })
      .lean()
    return docs.map(mapNpcIntent)
  }

  async recentOutcomesForCharacter(
    characterId: number,
    limit: number,
  ): Promise<NpcIntentRow[]> {
    const docs = await this.ctx.models.NpcIntent.find({
      characterId,
      narratorDisposition: { $ne: null },
    })
      .sort({ id: -1 })
      .limit(Math.max(1, Math.min(20, limit)))
      .lean()
    return docs.map(mapNpcIntent)
  }

  async setNarratorTurn(intentId: number, narratorTurnId: number): Promise<void> {
    await this.ctx.models.NpcIntent.updateOne(
      { id: intentId },
      { $set: { narratorTurnId, updatedAt: new Date() } },
      { session: this.session },
    )
  }

  async reconcile(input: ReconcileIntentInput): Promise<void> {
    await this.ctx.models.NpcIntent.updateOne(
      { id: input.intentId },
      {
        $set: {
          narratorTurnId: input.narratorTurnId,
          narratorDisposition: input.disposition,
          narratorInterpretation: input.interpretation ?? null,
          outcomeSummary: input.outcomeSummary ?? null,
          resolvedOutcome: input.resolvedOutcome ?? null,
          reconciliationConfidence: input.confidence ?? null,
          updatedAt: new Date(),
        },
      },
      { session: this.session },
    )
  }

  async reconcileBatch(results: ReconcileBatchResult[]): Promise<void> {
    for (const r of results) await this.reconcile(r)
  }

  async attachToNarratorTurn(
    intentIds: number[],
    narratorTurnId: number,
  ): Promise<void> {
    if (intentIds.length === 0) return
    await this.ctx.models.NpcIntent.updateMany(
      { id: { $in: intentIds } },
      { $set: { narratorTurnId, updatedAt: new Date() } },
      { session: this.session },
    )
  }
}
