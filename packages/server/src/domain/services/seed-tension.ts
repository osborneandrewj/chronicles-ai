// Pure domain rule (P6): guarantee a freshly-generated ensemble carries at least
// one relationship charged enough to ever fire an off-screen living-sim beat.
// The living tick only emits a beat when a co-located group has some relationship
// with |valence| >= the beat threshold (DEFAULT_TENSION_THRESHOLD, 0.25, in the
// tick-living-world use case). A near-neutral seeded crew never clears it, so its
// off-screen drama is effectively zero. This service bumps the single most-charged
// edge up to a floor when nothing already clears the threshold. No I/O — the seed
// use case runs it over the generated relationships before persisting them.
//
// Two knobs: SEED_TENSION_MIN (0.3) is the "already charged enough, leave it
// alone" bar; SEED_TENSION_FLOOR (0.35) is the level a too-weak edge is bumped
// up to. Both sit above the 0.25 beat threshold, so any edge this service leaves
// or sets can fire a beat. Keep the floor >= the threshold (a test asserts it).

import type { GeneratedRelationship } from '@/domain/ports/ensemble-generator'

export const SEED_TENSION_MIN = 0.3
export const SEED_TENSION_FLOOR = 0.35

export function ensureSeedTension(
  rels: GeneratedRelationship[],
  opts: { minThreshold?: number; floor?: number } = {},
): GeneratedRelationship[] {
  const min = opts.minThreshold ?? SEED_TENSION_MIN
  const floor = opts.floor ?? SEED_TENSION_FLOOR
  if (rels.length === 0) return rels
  // Already has a charged edge — leave the LLM/generator output untouched.
  if (rels.some((r) => Math.abs(r.valence) >= min)) return rels

  // Pick the most-charged edge (deterministic: the first maximum). Bump its
  // magnitude to the floor, preserving its sign so a warm-but-weak crew stays
  // warm. An all-zero ensemble has no sign to preserve, so bias to tension
  // (negative) — strife produces more dramatically useful off-screen beats.
  let idx = 0
  for (let i = 1; i < rels.length; i += 1) {
    if (Math.abs(rels[i].valence) > Math.abs(rels[idx].valence)) idx = i
  }
  const v = rels[idx].valence
  const sign = v < 0 ? -1 : v > 0 ? 1 : -1
  return rels.map((rel, i) => (i === idx ? { ...rel, valence: sign * floor } : rel))
}
