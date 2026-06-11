// MemoryRepository port (spec §4.8) — the Phase-2 vector-retrieval slot. No
// embeddings provider is wired today (no Voyage usage, no `memory_chunks`), so
// this is net-new surface kept non-empty: `searchSimilar` returns the top-`k`
// memory chunks for a world by cosine similarity to `embedding`. Both stores
// ship a no-op adapter returning `[]` (the context assembler already tolerates
// an empty retrieval — graceful degradation). The Atlas `$vectorSearch` /
// Qdrant adapter drops in later behind this same port with a composition-root
// flip. Async by mandate (spec §5.3).
export type MemoryChunk = {
  id: number
  worldId: number
  text: string
  score: number
}

export interface MemoryRepository {
  searchSimilar(
    worldId: number,
    embedding: number[],
    k: number,
  ): Promise<MemoryChunk[]>
}
