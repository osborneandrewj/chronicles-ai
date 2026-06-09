import { describe, expect, it } from 'vitest'

import type { CharacterRelationship } from '@/domain/entities'
import {
  applyDrift,
  coLocationOutcome,
  driftFromOutcome,
} from '@/domain/services/relationship-drift'

// Pure valence-delta application for the bounded-world pre-sim (P2). A beat
// outcome maps to a small signed delta; applyDrift folds it into a relationship's
// valence, clamped to [-1, 1], without mutating the input row.

function rel(valence: number): CharacterRelationship {
  return {
    id: 1,
    world_id: 7,
    from_character_id: 10,
    to_character_id: 11,
    kind: 'rival',
    valence,
    note: null,
    updated_at: null,
  }
}

describe('driftFromOutcome', () => {
  it('maps a positive outcome to a small positive delta', () => {
    expect(driftFromOutcome('positive')).toBeGreaterThan(0)
  })

  it('maps a negative outcome to a small negative delta', () => {
    expect(driftFromOutcome('negative')).toBeLessThan(0)
  })

  it('maps a neutral outcome to zero', () => {
    expect(driftFromOutcome('neutral')).toBe(0)
  })

  it('keeps the signed deltas symmetric and small', () => {
    expect(driftFromOutcome('positive')).toBe(-driftFromOutcome('negative'))
    expect(Math.abs(driftFromOutcome('positive'))).toBeLessThanOrEqual(0.2)
  })
})

describe('coLocationOutcome', () => {
  it("maps a positive valence to 'positive' (allies bond when together)", () => {
    expect(coLocationOutcome(0.4)).toBe('positive')
  })

  it("maps a zero valence to 'positive' (the boundary is inclusive)", () => {
    expect(coLocationOutcome(0)).toBe('positive')
  })

  it("maps a negative valence to 'negative' (rivals chafe)", () => {
    expect(coLocationOutcome(-0.3)).toBe('negative')
  })
})

describe('applyDrift', () => {
  it('folds the delta into valence', () => {
    const next = applyDrift(rel(0), 0.1)
    expect(next.valence).toBeCloseTo(0.1)
  })

  it('clamps at the upper bound of 1', () => {
    expect(applyDrift(rel(0.95), 0.5).valence).toBe(1)
  })

  it('clamps at the lower bound of -1', () => {
    expect(applyDrift(rel(-0.95), -0.5).valence).toBe(-1)
  })

  it('does not mutate the input relationship', () => {
    const input = rel(0.3)
    const next = applyDrift(input, 0.4)
    expect(input.valence).toBe(0.3)
    expect(next).not.toBe(input)
    expect(next.valence).toBeCloseTo(0.7)
  })

  it('preserves every other field unchanged', () => {
    const input = rel(0.2)
    const next = applyDrift(input, -0.1)
    expect(next).toMatchObject({
      id: input.id,
      world_id: input.world_id,
      from_character_id: input.from_character_id,
      to_character_id: input.to_character_id,
      kind: input.kind,
      note: input.note,
      updated_at: input.updated_at,
    })
  })
})
