// Pure domain service (Phase B, B4) — ambiguous codename generation.
//
// The player-facing name of an adventure must NOT encode the genre or hint at
// the simulation frame. Diegetically the facility refers to its simulations by
// protocol number, not content — so we mint an opaque designator ("Protocol
// 457", "Sequence Theta-9", "Designation Vesper") that the player cannot read
// the setting from. This replaces the hardcoded player-visible "Scout Vessel".
//
// Pure + deterministic: the seed is injected (no Math.random in the domain), so
// the same seed always yields the same codename — testable, and reproducible
// across the creation flow.

const PREFIXES = [
  'Protocol',
  'Sequence',
  'Archive',
  'Cycle',
  'Designation',
  'Directive',
  'Vector',
  'Index',
  'Case',
  'Operation',
  'Schema',
  'Pattern',
  'Iteration',
  'Record',
  'Trial',
  'Cluster',
  'Channel',
  'Register',
] as const

const GREEK = [
  'Alpha',
  'Beta',
  'Gamma',
  'Delta',
  'Epsilon',
  'Zeta',
  'Eta',
  'Theta',
  'Iota',
  'Kappa',
  'Lambda',
  'Sigma',
  'Omega',
  'Tau',
  'Phi',
  'Chi',
  'Psi',
  'Omicron',
] as const

// Evocative but genre-neutral codewords — none names a place, era, or setting.
const CODEWORDS = [
  'Vesper',
  'Halcyon',
  'Cinder',
  'Ardent',
  'Mirror',
  'Lantern',
  'Tessera',
  'Vellum',
  'Onyx',
  'Solace',
  'Marrow',
  'Ember',
  'Hollow',
  'Cradle',
  'Vigil',
  'Sable',
  'Cobalt',
  'Pallid',
] as const

// mulberry32 — a tiny deterministic PRNG so the domain stays free of Math.random.
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

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)]
}

export function generateCodename(seed: number): string {
  const rng = mulberry32(seed >>> 0)
  const prefix = pick(PREFIXES, rng)
  const style = Math.floor(rng() * 3)
  if (style === 0) {
    const n = 100 + Math.floor(rng() * 900) // 100–999
    return `${prefix} ${n}`
  }
  if (style === 1) {
    const n = 1 + Math.floor(rng() * 99) // 1–99
    return `${prefix} ${pick(GREEK, rng)}-${n}`
  }
  return `${prefix} ${pick(CODEWORDS, rng)}`
}
