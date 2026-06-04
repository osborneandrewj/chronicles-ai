// Helpers for writing and reading the characters.memorable_facts column.
//
// Each fact is suffixed with [t:N] at write time so that when v0.7 promotes
// memorable_facts to chunked embeddings, the source turn for each fact is
// recoverable deterministically rather than heuristically. Provenance is
// metadata, not story — neither the archivist (writes) nor the narrator
// (reads) sees the suffixes; both go through stripFactProvenance first.

const FACT_PROVENANCE_RE = /\s*\[t:\d+\]\s*$/

export function appendFactWithProvenance(
  existing: string | null,
  fact: string | undefined,
  turnId: number,
): string | null {
  const trimmed = fact?.trim()
  if (!trimmed) return null
  const annotated = `${trimmed} [t:${turnId}]`
  return existing && existing.length > 0 ? `${existing}\n${annotated}` : annotated
}

export function stripFactProvenance(facts: string | null): string | null {
  if (!facts) return facts
  return facts
    .split('\n')
    .map((line) => line.replace(FACT_PROVENANCE_RE, '').trimEnd())
    .join('\n')
}
