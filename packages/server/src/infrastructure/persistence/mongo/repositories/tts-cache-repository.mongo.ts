import 'server-only'

import type { CachedTtsAudio } from '@/domain/entities'
import type { TtsCacheRepository } from '@/domain/ports/tts-cache-repository'

import type { MongoContext } from '../mongo-context'

// Mongo TtsCacheRepository (spec §4.2, §4.6). The only binary collection. `store`
// upserts then runs the turn-based retention prune in ONE transaction (mirrors
// the SQLite `db.transaction(upsert; prune)`), so an evicted old turn that
// re-synthesizes is re-pruned in the same commit rather than displacing a recent
// turn. Retention keeps rows whose turnId is among the newest N distinct turnIds.
//
// `store` only writes if the target turn exists and is an assistant turn (mirrors
// the SQLite `SELECT ... FROM turns WHERE role = 'assistant'` guard).
export class MongoTtsCacheRepository implements TtsCacheRepository {
  constructor(private readonly ctx: MongoContext) {}

  async get(
    worldId: number,
    turnId: number,
    modelKey: string,
    voiceId: string,
    textHash: string,
  ): Promise<CachedTtsAudio | null> {
    const doc = await this.ctx.models.TtsAudioCache.findOne({
      worldId,
      turnId,
      modelKey,
      voiceId,
      textHash,
    }).lean()
    if (!doc) return null
    return {
      contentType: doc.contentType,
      audio: Buffer.from(doc.audio),
      byteLength: doc.byteLength,
    }
  }

  async store(input: {
    worldId: number
    turnId: number
    modelKey: string
    voiceId: string
    textHash: string
    contentType: string
    audio: Buffer
    turnsPerWorld?: number
  }): Promise<void> {
    const turnsPerWorld = input.turnsPerWorld ?? 2

    // Guard: only cache for an existing assistant turn (SQLite parity).
    const turn = await this.ctx.models.Turn.findOne({
      worldId: input.worldId,
      seq: input.turnId,
      role: 'assistant',
    })
      .select({ _id: 1 })
      .lean()
    if (!turn) return

    const session = await this.ctx.connection.startSession()
    try {
      await session.withTransaction(async () => {
        this.ctx.setSession(session)
        try {
          // Upsert on the compound key.
          const existing = await this.ctx.models.TtsAudioCache.findOne({
            worldId: input.worldId,
            turnId: input.turnId,
            modelKey: input.modelKey,
            voiceId: input.voiceId,
            textHash: input.textHash,
          })
            .select({ _id: 1 })
            .session(session)
          if (existing) {
            await this.ctx.models.TtsAudioCache.updateOne(
              { _id: existing._id },
              {
                $set: {
                  contentType: input.contentType,
                  audio: input.audio,
                  byteLength: input.audio.byteLength,
                },
              },
              { session },
            )
          } else {
            const id = await this.ctx.nextSeq('ttsAudioCacheId')
            await this.ctx.models.TtsAudioCache.create(
              [
                {
                  id,
                  worldId: input.worldId,
                  turnId: input.turnId,
                  modelKey: input.modelKey,
                  voiceId: input.voiceId,
                  textHash: input.textHash,
                  contentType: input.contentType,
                  audio: input.audio,
                  byteLength: input.audio.byteLength,
                  createdAt: new Date(),
                },
              ],
              { session },
            )
          }

          // Turn-based retention: keep rows whose turnId is among the newest N
          // DISTINCT turnIds for the world; evict the rest.
          const distinctTurnIds = (
            await this.ctx.models.TtsAudioCache.find({ worldId: input.worldId })
              .distinct('turnId')
              .session(session)
          ) as number[]
          const keep = [...distinctTurnIds]
            .sort((a, b) => b - a)
            .slice(0, turnsPerWorld)
          await this.ctx.models.TtsAudioCache.deleteMany(
            { worldId: input.worldId, turnId: { $nin: keep } },
            { session },
          )
        } finally {
          this.ctx.setSession(null)
        }
      })
    } finally {
      this.ctx.setSession(null)
      await session.endSession()
    }
  }
}
