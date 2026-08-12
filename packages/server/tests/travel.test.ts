import { describe, expect, it } from 'vitest'

import type { DeckGraph } from '@/domain/entities'
import {
  estimateTravelMinutes,
  nextHopToward,
  resolveArrivals,
  shortestPath,
  startJourney,
} from '@/domain/services/travel'

// Meridian-shaped mini bunker: Ops(1) - Corridor(2) - Mess(3); Corridor - Vault(4)
const GRAPH: DeckGraph = {
  adjacency: {
    1: [2],
    2: [1, 3, 4],
    3: [2],
    4: [2],
  },
}

describe('shortestPath / nextHopToward', () => {
  it('finds multi-hop path Ops → Mess', () => {
    expect(shortestPath(GRAPH, 1, 3)).toEqual([1, 2, 3])
  })

  it('one hop toward non-adjacent is never a long-jump', () => {
    expect(nextHopToward(GRAPH, 1, 3)).toBe(2)
    expect(nextHopToward(GRAPH, 1, 4)).toBe(2)
    expect(nextHopToward(GRAPH, 3, 1)).toBe(2)
  })

  it('adjacent hop lands on target', () => {
    expect(nextHopToward(GRAPH, 2, 4)).toBe(4)
  })
})

describe('estimateTravelMinutes', () => {
  it('bounded multi-hop sums edges with cap', () => {
    const m = estimateTravelMinutes({
      spatialMode: 'bounded',
      graph: GRAPH,
      fromPlaceId: 1,
      toPlaceId: 3,
    })
    expect(m).toBe(6) // 2 hops × 3
  })

  it('open-world same settlement uses band', () => {
    const m = estimateTravelMinutes({
      spatialMode: 'open',
      graph: null,
      fromPlaceId: 1,
      toPlaceId: 99,
    })
    expect(m).toBe(20)
  })
})

describe('startJourney', () => {
  it('rejects already-there', () => {
    const r = startJourney({
      characterId: 1,
      fromPlaceId: 2,
      toPlaceId: 2,
      clockMinutes: 100,
      spatialMode: 'bounded',
      graph: GRAPH,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('already_there')
  })

  it('bounded multi-hop schedules first hop only', () => {
    const r = startJourney({
      characterId: 7,
      fromPlaceId: 1,
      toPlaceId: 3,
      clockMinutes: 100,
      spatialMode: 'bounded',
      graph: GRAPH,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.journey.remainingPlaceIds).toEqual([2, 3])
    expect(r.journey.arriveMinutes).toBe(103) // first hop
    expect(r.journey.toPlaceId).toBe(3)
  })
})

describe('resolveArrivals', () => {
  it('keeps en_route when clock is early', () => {
    const writes = resolveArrivals({
      travelers: [
        {
          characterId: 1,
          currentPlaceId: 1,
          inTransitToPlaceId: 3,
          arrivalMinutes: 200,
          arrivalWorldTime: null,
          journeyPath: [2, 3],
        },
      ],
      clockMinutes: 150,
    })
    expect(writes).toHaveLength(0)
  })

  it('lands intermediate hop then final hop across calls', () => {
    const hop1 = resolveArrivals({
      travelers: [
        {
          characterId: 1,
          currentPlaceId: 1,
          inTransitToPlaceId: 3,
          arrivalMinutes: 103,
          arrivalWorldTime: null,
          journeyPath: [2, 3],
        },
      ],
      clockMinutes: 103,
      hopMinutes: 3,
    })
    expect(hop1).toHaveLength(1)
    expect(hop1[0]!.currentPlaceId).toBe(2)
    expect(hop1[0]!.landed).toBe(false)
    expect(hop1[0]!.remainingPlaceIds).toEqual([3])
    expect(hop1[0]!.inTransitToPlaceId).toBe(3)

    const hop2 = resolveArrivals({
      travelers: [
        {
          characterId: 1,
          currentPlaceId: hop1[0]!.currentPlaceId,
          inTransitToPlaceId: hop1[0]!.inTransitToPlaceId,
          arrivalMinutes: hop1[0]!.arrivalMinutes,
          arrivalWorldTime: hop1[0]!.arrivalWorldTime,
          journeyPath: hop1[0]!.remainingPlaceIds,
        },
      ],
      clockMinutes: hop1[0]!.arrivalMinutes!,
    })
    expect(hop2).toHaveLength(1)
    expect(hop2[0]!.currentPlaceId).toBe(3)
    expect(hop2[0]!.landed).toBe(true)
    expect(hop2[0]!.inTransitToPlaceId).toBeNull()
  })

  it('lands final at exact minute for single-leg journey', () => {
    const writes = resolveArrivals({
      travelers: [
        {
          characterId: 9,
          currentPlaceId: 1,
          inTransitToPlaceId: 4,
          arrivalMinutes: 50,
          arrivalWorldTime: null,
          journeyPath: [4],
        },
      ],
      clockMinutes: 50,
    })
    expect(writes).toHaveLength(1)
    expect(writes[0]!.landed).toBe(true)
    expect(writes[0]!.currentPlaceId).toBe(4)
  })
})
