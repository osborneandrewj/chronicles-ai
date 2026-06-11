import 'server-only'

import type { MemoryChunk, MemoryRepository } from '@/domain/ports/memory-repository'

// SQLite MemoryRepository — the Phase-2 vector slot (spec §4.8). No
// `memory_chunks` table exists in the shipped SQLite schema and no embeddings
// provider is wired, so this returns `[]`. The context assembler degrades
// gracefully on an empty retrieval. Kept so the port surface is non-empty and
// the real adapter drops in later behind the same port.
export class SqliteMemoryRepository implements MemoryRepository {
  searchSimilar(
    worldId: number,
    embedding: number[],
    k: number,
  ): Promise<MemoryChunk[]> {
    void worldId
    void embedding
    void k
    return Promise.resolve([])
  }
}
