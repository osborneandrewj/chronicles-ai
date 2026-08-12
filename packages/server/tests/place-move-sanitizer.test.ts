import { describe, expect, it } from 'vitest'

import type { DeckGraph } from '@/domain/entities'
import { sanitizePlaceMove } from '@/domain/services/place-move-sanitizer'

const GRAPH: DeckGraph = {
  adjacency: {
    1: [2],
    2: [1, 3],
    3: [2],
  },
}

describe('sanitizePlaceMove', () => {
  it('converts NPC place change to journey, not instant present', () => {
    const r = sanitizePlaceMove({
      character: {
        id: 5,
        name: 'Reyes',
        is_player: 0,
        current_place_id: 1,
        in_transit_to_place_id: null,
      },
      proposed: { name: 'Reyes', toPlaceId: 3 },
      clockMinutes: 100,
      spatialMode: 'bounded',
      graph: GRAPH,
      knownPlaceIds: new Set([1, 2, 3]),
    })
    expect(r.kind).toBe('journey')
    if (r.kind !== 'journey') return
    expect(r.in_transit_to_place_id).toBe(3)
    expect(r.arrival_minutes).toBeGreaterThan(100)
    // No current_place_id on journey write — still at origin until resolve.
    expect('current_place_id' in r).toBe(false)
  })

  it('allows player instant move', () => {
    const r = sanitizePlaceMove({
      character: {
        id: 1,
        name: 'Player',
        is_player: 1,
        current_place_id: 1,
        in_transit_to_place_id: null,
      },
      proposed: { name: 'Player', toPlaceId: 3 },
      clockMinutes: 100,
      spatialMode: 'bounded',
      graph: GRAPH,
      knownPlaceIds: new Set([1, 2, 3]),
    })
    expect(r.kind).toBe('instant')
    if (r.kind !== 'instant') return
    expect(r.current_place_id).toBe(3)
  })
})
