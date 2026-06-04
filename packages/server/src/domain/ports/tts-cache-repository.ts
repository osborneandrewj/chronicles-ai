import type { CachedTtsAudio } from '@/lib/db'

// TtsCacheRepository (spec §3.4, "TtsAudioCacheRepository") — dumb CRUD over the
// synthesized-audio cache. Turn-based retention pruning runs inside the same
// transaction as the upsert (mirrors the SQLite adapter's `db.transaction`).
// Async by mandate (spec §5.3).
export interface TtsCacheRepository {
  get(
    worldId: number,
    turnId: number,
    modelKey: string,
    voiceId: string,
    textHash: string,
  ): Promise<CachedTtsAudio | null>
  store(input: {
    worldId: number
    turnId: number
    modelKey: string
    voiceId: string
    textHash: string
    contentType: string
    audio: Buffer
    turnsPerWorld?: number
  }): Promise<void>
}
