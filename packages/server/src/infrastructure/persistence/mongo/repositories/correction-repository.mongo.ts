import 'server-only'

import type { WorldCorrectionRow } from '@/domain/entities'
import type { CorrectionRepository } from '@/domain/ports/correction-repository'

import type { MongoContext } from '../mongo-context'
import { mapWorldCorrection, toSqliteDatetime } from './mappers'

// Mongo WorldCorrectionRepository (spec §4.2) — append-only audit of
// player→archivist corrections. `appliedPatch` is the serialized ArchivistPatch
// JSON so a row is self-describing. Read newest-first.
export class MongoCorrectionRepository implements CorrectionRepository {
  constructor(private readonly ctx: MongoContext) {}

  async insert(
    worldId: number,
    turnId: number | null,
    playerText: string,
    archivistReply: string,
    appliedPatch: unknown,
  ): Promise<WorldCorrectionRow> {
    const id = await this.ctx.nextSeq('worldCorrectionId')
    const createdAt = new Date()
    const appliedPatchJson = JSON.stringify(appliedPatch)
    await this.ctx.models.WorldCorrection.create(
      [
        {
          id,
          worldId,
          turnId,
          playerText,
          archivistReply,
          appliedPatch: appliedPatchJson,
          createdAt,
        },
      ],
      { session: this.ctx.currentSession ?? undefined },
    )
    return {
      id,
      world_id: worldId,
      turn_id: turnId,
      player_text: playerText,
      archivist_reply: archivistReply,
      applied_patch: appliedPatchJson,
      created_at: toSqliteDatetime(createdAt),
    }
  }

  async forWorld(worldId: number, limit = 50): Promise<WorldCorrectionRow[]> {
    const docs = await this.ctx.models.WorldCorrection.find({ worldId })
      .sort({ id: -1 })
      .limit(Math.max(1, Math.min(200, limit)))
      .lean()
    return docs.map(mapWorldCorrection)
  }
}
