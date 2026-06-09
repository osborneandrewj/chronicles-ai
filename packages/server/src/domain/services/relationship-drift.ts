import type { CharacterRelationship } from '@/domain/entities'

// Pure valence-drift for the bounded-world pre-sim (P2). A beat outcome maps to a
// small signed delta; applyDrift folds that delta into a relationship's valence,
// clamped to [-1, 1], returning a new row without mutating the input.

export type BeatOutcome = 'positive' | 'negative' | 'neutral'

const DRIFT_STEP = 0.1
const VALENCE_MIN = -1
const VALENCE_MAX = 1

// Deterministic co-location drift trigger (P2). Two co-located NPCs bond when
// their standing is already non-negative (allies warm up together) and chafe
// when it is negative (rivals grate). Pure sign test on the working valence.
export function coLocationOutcome(valence: number): BeatOutcome {
  return valence >= 0 ? 'positive' : 'negative'
}

export function driftFromOutcome(outcome: BeatOutcome): number {
  switch (outcome) {
    case 'positive':
      return DRIFT_STEP
    case 'negative':
      return -DRIFT_STEP
    case 'neutral':
      return 0
  }
}

export function applyDrift(rel: CharacterRelationship, delta: number): CharacterRelationship {
  const valence = clamp(rel.valence + delta, VALENCE_MIN, VALENCE_MAX)
  return { ...rel, valence }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
