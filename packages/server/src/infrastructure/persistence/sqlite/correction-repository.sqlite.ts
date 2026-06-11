import 'server-only'

import {
  getWorldCorrectionsForWorld,
  insertWorldCorrection,
  type WorldCorrectionRow,
} from '@/lib/db'
import type { CorrectionRepository } from '@/domain/ports/correction-repository'

// SQLite adapter for CorrectionRepository (spec §5.1-P1). Dumb CRUD over the
// player→archivist correction scrollback.
export class SqliteCorrectionRepository implements CorrectionRepository {
  insert(
    worldId: number,
    turnId: number | null,
    playerText: string,
    archivistReply: string,
    appliedPatch: unknown,
  ): Promise<WorldCorrectionRow> {
    return Promise.resolve(
      insertWorldCorrection(worldId, turnId, playerText, archivistReply, appliedPatch),
    )
  }

  forWorld(worldId: number, limit = 50): Promise<WorldCorrectionRow[]> {
    return Promise.resolve(getWorldCorrectionsForWorld(worldId, limit))
  }
}
