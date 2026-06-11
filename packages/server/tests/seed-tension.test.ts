import { describe, expect, it } from 'vitest'

import type { GeneratedRelationship } from '@/domain/ports/ensemble-generator'
import { ensureSeedTension, SEED_TENSION_FLOOR } from '@/domain/services/seed-tension'
import { DEFAULT_TENSION_THRESHOLD } from '@/application/use-cases/tick-living-world'

const rel = (valence: number, i = 0): GeneratedRelationship => ({
  fromRole: `a${i}`,
  toRole: `b${i}`,
  kind: 'ally',
  valence,
})

describe('ensureSeedTension', () => {
  it('bumps exactly one edge to tension (-floor) for an all-zero ensemble, leaving the rest', () => {
    const out = ensureSeedTension([rel(0, 0), rel(0, 1), rel(0, 2)])
    const charged = out.filter((r) => r.valence !== 0)
    expect(charged).toHaveLength(1)
    expect(charged[0]?.valence).toBeCloseTo(-SEED_TENSION_FLOOR)
  })

  it('leaves an ensemble that already clears the threshold untouched', () => {
    const input = [rel(0.5, 0), rel(0, 1)]
    expect(ensureSeedTension(input)).toEqual(input)
  })

  it('bumps the most-charged weak edge and preserves its (negative) sign', () => {
    const out = ensureSeedTension([rel(0.1, 0), rel(-0.2, 1)])
    expect(out[0]?.valence).toBeCloseTo(0.1) // untouched
    expect(out[1]?.valence).toBeCloseTo(-SEED_TENSION_FLOOR) // most-charged, sign kept
  })

  it('preserves a positive sign for a warm-but-weak ensemble (not flipped to tension)', () => {
    const out = ensureSeedTension([rel(0.2, 0), rel(0.1, 1)])
    expect(out[0]?.valence).toBeCloseTo(SEED_TENSION_FLOOR) // +floor, stays warm
    expect(out[1]?.valence).toBeCloseTo(0.1)
  })

  it('returns an empty array unchanged', () => {
    expect(ensureSeedTension([])).toEqual([])
  })

  it('is deterministic — a magnitude tie picks the lowest index', () => {
    const out = ensureSeedTension([rel(0.1, 0), rel(0.1, 1)])
    expect(out[0]?.valence).toBeCloseTo(SEED_TENSION_FLOOR)
    expect(out[1]?.valence).toBeCloseTo(0.1)
  })

  it('keeps the floor above the live off-screen beat threshold', () => {
    expect(SEED_TENSION_FLOOR).toBeGreaterThanOrEqual(DEFAULT_TENSION_THRESHOLD)
  })
})
