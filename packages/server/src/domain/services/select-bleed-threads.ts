// Pure domain service (Phase C, C9) — one-way meta-story bleed. The hub's
// Meta-Story Bible carries recurring motifs (a figure, a phrase, an impossible
// object) meant to cross EVERY simulation regardless of era — the thread that
// whispers "something is wrong with all of this". This picks a bounded set of
// those motifs to inject into a subworld's narrator state and the drama-beat
// `threads` slot. The bleed is ONE-WAY: motifs flow hub → subworld, never back.
// Deterministic (seed injected); no I/O.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function selectBleedThreads(
  motifs: string[],
  opts: { max?: number; seed?: number } = {},
): string[] {
  const max = opts.max ?? 2
  const pool = motifs.map((m) => m.trim()).filter((m) => m.length > 0)
  if (pool.length <= max) return pool
  // Deterministic shuffle, take `max`.
  const rng = mulberry32(opts.seed ?? 0)
  const shuffled = [...pool]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled.slice(0, max)
}
