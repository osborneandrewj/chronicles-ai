import 'server-only'

import type { MemoryChunk, MemoryRepository } from '@/domain/ports/memory-repository'

// Mongo MemoryRepository — the Phase-2 vector slot (spec §4.8). The Mongo
// equivalent of pgvector is Atlas `$vectorSearch` over a `memory_chunks`
// collection (or an external Qdrant store for self-hosted single-node). Neither
// is wired today, so this returns `[]`; the context assembler degrades
// gracefully. The real `$vectorSearch` adapter drops in here behind the same
// port with a composition-root flip.
export class MongoMemoryRepository implements MemoryRepository {
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
