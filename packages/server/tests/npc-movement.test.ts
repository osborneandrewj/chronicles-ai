import { describe, expect, it } from 'vitest'

import { nextPlaceId } from '@/domain/services/npc-movement'

// Pure next-room resolution for one NPC per tick (starship pre-sim P2). The
// daily_loop is resolved to place ids (band -> target place id) by the use case
// before this service runs; neighbours are injected so the service never touches
// the deck graph directly. Movement is teleport-tolerant for a tiny ship, but the
// result is always constrained to {current, a neighbour, the loop target}.

// A 6-room scout: bridge(1) - corridor(2) - {quarters(3), mess(4)}; corridor(2)
// also reaches engine(5); med-bay(6) hangs off quarters(3).
const ADJACENCY: Record<number, number[]> = {
  1: [2],
  2: [1, 3, 4, 5],
  3: [2, 6],
  4: [2],
  5: [2],
  6: [3],
}

function neighborsOf(placeId: number): number[] {
  return ADJACENCY[placeId] ?? []
}

describe('nextPlaceId — routine drives movement', () => {
  it('steps to the loop target when it is a direct neighbour', () => {
    const next = nextPlaceId({
      dailyLoop: { morning: 5 },
      band: 'morning',
      currentPlaceId: 2,
      neighborsOf,
    })
    expect(next).toBe(5)
  })

  it('teleports directly to the loop target when it is not a neighbour', () => {
    // From quarters(3) the engineer is due on the bridge(1); bridge is not a
    // neighbour of quarters, so on a tiny ship we step straight there.
    const next = nextPlaceId({
      dailyLoop: { evening: 1 },
      band: 'evening',
      currentPlaceId: 3,
      neighborsOf,
    })
    expect(next).toBe(1)
  })

  it('never returns a place that is not current, a neighbour, or the target', () => {
    const target = 6
    const current = 2
    const next = nextPlaceId({
      dailyLoop: { night: target },
      band: 'night',
      currentPlaceId: current,
      neighborsOf,
    })
    const allowed = new Set<number>([current, target, ...neighborsOf(current)])
    expect(next).not.toBeNull()
    expect(allowed.has(next as number)).toBe(true)
  })
})

describe('nextPlaceId — stays put', () => {
  it('stays when already at the loop target for this band', () => {
    const next = nextPlaceId({
      dailyLoop: { midday: 4 },
      band: 'midday',
      currentPlaceId: 4,
      neighborsOf,
    })
    expect(next).toBe(4)
  })

  it('stays when the band has no loop entry (missing routine)', () => {
    const next = nextPlaceId({
      dailyLoop: { morning: 5 },
      band: 'night',
      currentPlaceId: 2,
      neighborsOf,
    })
    expect(next).toBe(2)
  })

  it('stays when the daily loop is null', () => {
    const next = nextPlaceId({
      dailyLoop: null,
      band: 'midday',
      currentPlaceId: 3,
      neighborsOf,
    })
    expect(next).toBe(3)
  })

  it('stays when the band entry resolves to an unknown (null) target', () => {
    const next = nextPlaceId({
      dailyLoop: { midday: null },
      band: 'midday',
      currentPlaceId: 3,
      neighborsOf,
    })
    expect(next).toBe(3)
  })
})

describe('nextPlaceId — null current place', () => {
  it('returns null when there is no current place and no target', () => {
    const next = nextPlaceId({
      dailyLoop: null,
      band: 'midday',
      currentPlaceId: null,
      neighborsOf,
    })
    expect(next).toBeNull()
  })

  it('jumps to the loop target when current place is null but a target exists', () => {
    const next = nextPlaceId({
      dailyLoop: { morning: 1 },
      band: 'morning',
      currentPlaceId: null,
      neighborsOf,
    })
    expect(next).toBe(1)
  })
})
