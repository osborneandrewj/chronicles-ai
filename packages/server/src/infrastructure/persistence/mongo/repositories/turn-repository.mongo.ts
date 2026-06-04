import 'server-only'

import type {
  AssistantTurnMetadata,
  Turn,
  TurnRole,
  TurnTimestamp,
} from '@/domain/entities'
import type { TurnRepository } from '@/domain/ports/turn-repository'

import type { MongoContext } from '../mongo-context'
import { mapTurn, toSqliteDatetime } from './mappers'

// Mongo TurnRepository (spec §4.4, §4.5). APPEND-ONLY: the only create is
// `insert` (allocates the monotone `seq` from the `counters` collection inside
// the active session so the counter + turn commit atomically), and the only
// mutations are the two narrow metadata ops:
//   - `mergeMetadata`: `$set` on the nested `metadata.<agentKey>` path — additive
//     per agent, never a document replace (mirrors json_patch; disjoint writers
//     don't clobber).
//   - `incTtsChars`: `$inc` on `metadata.tts.chars` (mirrors json_set additive).
// There is deliberately NO general update / setMetadata: no write touches
// `content`, `role`, or `seq` after insert (the guard test asserts this).
export class MongoTurnRepository implements TurnRepository {
  constructor(private readonly ctx: MongoContext) {}

  private get session() {
    return this.ctx.currentSession ?? undefined
  }

  async insert(
    worldId: number,
    role: TurnRole,
    content: string,
    sceneId: number | null = null,
  ): Promise<Turn> {
    const seq = await this.ctx.nextSeq('turnSeq')
    const createdAt = new Date()
    await this.ctx.models.Turn.create(
      [{ seq, worldId, role, content, sceneId, metadata: {}, createdAt }],
      { session: this.session },
    )
    return {
      id: seq,
      world_id: worldId,
      role,
      content,
      scene_id: sceneId,
      created_at: toSqliteDatetime(createdAt),
    }
  }

  async allForWorld(worldId: number): Promise<Turn[]> {
    const docs = await this.ctx.models.Turn.find({ worldId })
      .sort({ seq: 1 })
      .lean()
    return docs.map(mapTurn)
  }

  async recentTurns(
    worldId: number,
    limit: number,
  ): Promise<Array<Pick<Turn, 'id' | 'role' | 'content'>>> {
    const docs = await this.ctx.models.Turn.find({ worldId })
      .sort({ seq: -1 })
      .limit(limit)
      .lean()
    return docs
      .reverse()
      .map((d) => ({ id: d.seq, role: d.role, content: d.content }))
  }

  async latestTurns(worldId: number, limit: number): Promise<Turn[]> {
    const docs = await this.ctx.models.Turn.find({ worldId })
      .sort({ seq: -1 })
      .limit(limit)
      .lean()
    return docs.reverse().map(mapTurn)
  }

  async turnsBefore(
    worldId: number,
    beforeId: number,
    limit: number,
  ): Promise<Turn[]> {
    const docs = await this.ctx.models.Turn.find({ worldId, seq: { $lt: beforeId } })
      .sort({ seq: -1 })
      .limit(limit)
      .lean()
    return docs.reverse().map(mapTurn)
  }

  async latestUserContent(worldId: number): Promise<string | null> {
    const doc = await this.ctx.models.Turn.findOne({ worldId, role: 'user' })
      .sort({ seq: -1 })
      .lean()
    return doc?.content ?? null
  }

  async latestTurn(worldId: number): Promise<Turn | null> {
    const doc = await this.ctx.models.Turn.findOne({ worldId }).sort({ seq: -1 }).lean()
    return doc ? mapTurn(doc) : null
  }

  async latestAssistantAfterLatestUser(worldId: number): Promise<Turn | null> {
    const latestUser = await this.ctx.models.Turn.findOne({ worldId, role: 'user' })
      .sort({ seq: -1 })
      .lean()
    const minSeq = latestUser?.seq ?? -1
    const doc = await this.ctx.models.Turn.findOne({
      worldId,
      role: 'assistant',
      seq: { $gt: minSeq },
    })
      .sort({ seq: -1 })
      .lean()
    return doc ? mapTurn(doc) : null
  }

  async userTurnCount(worldId: number): Promise<number> {
    return this.ctx.models.Turn.countDocuments({ worldId, role: 'user' })
  }

  async latestUserTurnId(worldId: number): Promise<number | null> {
    const doc = await this.ctx.models.Turn.findOne({ worldId, role: 'user' })
      .sort({ seq: -1 })
      .lean()
    return doc?.seq ?? null
  }

  async mergeMetadata(
    turnId: number,
    agentKey: string,
    block: Record<string, unknown>,
  ): Promise<void> {
    // Targeted $set on the nested per-agent path — additive, never clobber
    // (spec §4.4). Disjoint agent writers (archivist / tts / reconciler) keep
    // their own key; siblings survive.
    await this.ctx.models.Turn.updateOne(
      { seq: turnId },
      { $set: { [`metadata.${agentKey}`]: block } },
      { session: this.session },
    )
  }

  async incTtsChars(worldId: number, turnId: number, chars: number): Promise<void> {
    // Additive $inc on metadata.tts.chars (spec §4.4).
    await this.ctx.models.Turn.updateOne(
      { worldId, seq: turnId },
      { $inc: { 'metadata.tts.chars': chars } },
      { session: this.session },
    )
  }

  async latestMetadata(
    worldId: number,
  ): Promise<{ id: number; metadata: Record<string, unknown> } | null> {
    const doc = await this.ctx.models.Turn.findOne({
      worldId,
      metadata: { $ne: {} },
    })
      .sort({ seq: -1 })
      .lean()
    if (!doc) return null
    return { id: doc.seq, metadata: doc.metadata ?? {} }
  }

  async allAssistantMetadata(worldId: number): Promise<AssistantTurnMetadata[]> {
    const docs = await this.ctx.models.Turn.find({ worldId, role: 'assistant' })
      .sort({ seq: 1 })
      .lean()
    return docs.map((d) => ({ id: d.seq, metadata: d.metadata ?? {} }))
  }

  async assistantMetadataSince(
    worldId: number,
    minId: number,
  ): Promise<AssistantTurnMetadata[]> {
    const docs = await this.ctx.models.Turn.find({
      worldId,
      role: 'assistant',
      seq: { $gte: minId },
    })
      .sort({ seq: 1 })
      .lean()
    return docs.map((d) => ({ id: d.seq, metadata: d.metadata ?? {} }))
  }

  async assistantMetadataInRange(
    worldId: number,
    minId: number,
    maxIdExclusive: number,
  ): Promise<AssistantTurnMetadata[]> {
    const docs = await this.ctx.models.Turn.find({
      worldId,
      role: 'assistant',
      seq: { $gte: minId, $lt: maxIdExclusive },
    })
      .sort({ seq: 1 })
      .lean()
    return docs.map((d) => ({ id: d.seq, metadata: d.metadata ?? {} }))
  }

  async hasTurnBefore(worldId: number, id: number): Promise<boolean> {
    const doc = await this.ctx.models.Turn.findOne({ worldId, seq: { $lt: id } })
      .select({ _id: 1 })
      .lean()
    return doc != null
  }

  async turnTimestamps(worldId: number): Promise<TurnTimestamp[]> {
    const docs = await this.ctx.models.Turn.find({ worldId })
      .sort({ seq: 1 })
      .select({ seq: 1, createdAt: 1 })
      .lean()
    return docs.map((d) => ({ id: d.seq, created_at: toSqliteDatetime(d.createdAt) }))
  }
}
