import type { WorldCorrectionRow } from '@/domain/entities'

// CorrectionRepository (spec §3.4, "WorldCorrectionRepository") — dumb CRUD over
// the player→archivist correction scrollback. Async by mandate (spec §5.3).
export interface CorrectionRepository {
  insert(
    worldId: number,
    turnId: number | null,
    playerText: string,
    archivistReply: string,
    appliedPatch: unknown,
  ): Promise<WorldCorrectionRow>
  forWorld(worldId: number, limit?: number): Promise<WorldCorrectionRow[]>
}
