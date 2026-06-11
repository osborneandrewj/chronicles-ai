import 'server-only'

import {
  getCachedTtsAudio,
  storeCachedTtsAudio,
  type CachedTtsAudio,
} from '@/lib/db'
import type { TtsCacheRepository } from '@/domain/ports/tts-cache-repository'

// SQLite adapter for TtsCacheRepository (spec §5.1-P1). `store` delegates to
// `storeCachedTtsAudio`, which already runs the upsert + turn-based prune inside
// a single `db.transaction` — SQL and retention semantics unchanged.
export class SqliteTtsCacheRepository implements TtsCacheRepository {
  get(
    worldId: number,
    turnId: number,
    modelKey: string,
    voiceId: string,
    textHash: string,
  ): Promise<CachedTtsAudio | null> {
    return Promise.resolve(getCachedTtsAudio(worldId, turnId, modelKey, voiceId, textHash))
  }

  store(input: {
    worldId: number
    turnId: number
    modelKey: string
    voiceId: string
    textHash: string
    contentType: string
    audio: Buffer
    turnsPerWorld?: number
  }): Promise<void> {
    storeCachedTtsAudio(input)
    return Promise.resolve()
  }
}
