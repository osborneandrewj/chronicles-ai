// Helpers for writing and reading the characters.memorable_facts column.
//
// Each fact is suffixed with [t:N] at write time so that when v0.7 promotes
// memorable_facts to chunked embeddings, the source turn for each fact is
// recoverable deterministically rather than heuristically. Provenance is
// metadata, not story — neither the archivist (writes) nor the narrator
// (reads) sees the suffixes; both go through stripFactProvenance first.
//
// Phase A: the column was an unbounded append-only blob where each append
// carried a unique [t:N] suffix, so even verbatim duplicates never collapsed
// and the block grew without limit (the narrator only ever sees the last few
// lines, so recent facts repeat while older ones scroll out). Appends now
// dedup against existing lines (normalized, provenance-stripped) and the stored
// block is capped to the most-recent N lines.

const FACT_PROVENANCE_RE = /\s*\[t:\d+\]\s*$/

// Keep the block bounded. The narrator reads only the tail anyway; older facts
// belong in retrieved memory (v0.7), not in this hot column.
export const MAX_MEMORABLE_FACT_LINES = 12

// Two facts are near-duplicates if their normalized forms are equal, one is a
// whole-token substring of the other, or their token sets overlap heavily
// (Jaccard ≥ 0.7). Token-boundary containment collapses "she pockets the
// photograph" vs "she pockets the photograph again" without collapsing
// unrelated prefixes ("fact 1" is not inside "fact 10"); the Jaccard check
// collapses light rewordings ("a photograph" vs "the photograph").
const NEAR_DUP_JACCARD = 0.7

function normalizeFact(line: string): string {
  return line
    .replace(FACT_PROVENANCE_RE, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokenSet(norm: string): Set<string> {
  return new Set(norm.split(' ').filter((t) => t.length > 0))
}

function isNearDuplicate(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false
  if (a === b) return true
  // Whole-token containment: pad so " a b " only matches on token boundaries.
  const paddedA = ` ${a} `
  const paddedB = ` ${b} `
  if (paddedA.includes(paddedB) || paddedB.includes(paddedA)) return true
  const setA = tokenSet(a)
  const setB = tokenSet(b)
  if (setA.size < 3 || setB.size < 3) return false // too short to judge by overlap
  let shared = 0
  for (const t of setA) if (setB.has(t)) shared += 1
  const union = setA.size + setB.size - shared
  return union > 0 && shared / union >= NEAR_DUP_JACCARD
}

// Append `fact` to the existing block with a [t:N] provenance suffix. Skips the
// append (returning the block unchanged) when the fact is empty or a
// near-duplicate of an existing line, and caps the result to the most-recent
// MAX_MEMORABLE_FACT_LINES lines. Returns the full updated block (or the
// unchanged existing value); callers persist the return verbatim.
export function appendFactWithProvenance(
  existing: string | null,
  fact: string | undefined,
  turnId: number,
): string | null {
  const trimmed = fact?.trim()
  if (!trimmed) return existing ?? null

  const lines =
    existing && existing.length > 0
      ? existing.split('\n').filter((l) => l.trim().length > 0)
      : []

  const incomingNorm = normalizeFact(trimmed)
  const dupe = lines.some((l) => isNearDuplicate(normalizeFact(l), incomingNorm))
  if (dupe) return existing ?? null

  const next = [...lines, `${trimmed} [t:${turnId}]`]
  const capped =
    next.length > MAX_MEMORABLE_FACT_LINES ? next.slice(next.length - MAX_MEMORABLE_FACT_LINES) : next
  return capped.join('\n')
}

export function stripFactProvenance(facts: string | null): string | null {
  if (!facts) return facts
  return facts
    .split('\n')
    .map((line) => line.replace(FACT_PROVENANCE_RE, '').trimEnd())
    .join('\n')
}
