import { describe, expect, it } from 'vitest'

import type { PlaceConnection } from '@/domain/entities'
import {
  buildDeckGraph,
  isConnected,
  neighbors,
  orphanRooms,
} from '@/domain/services/deck-graph'

// Pure deck-topology graph ops over PlaceConnection[]. Fixtures model a tiny
// scout-ship layout: bridge(1) — corridor — mess(2) — corridor — quarters(3),
// plus a one-way ladder and an orphan med-bay used to exercise reachability.

function conn(
  from: number,
  to: number,
  bidirectional: number,
  id = from * 100 + to,
): PlaceConnection {
  return {
    id,
    world_id: 1,
    from_place_id: from,
    to_place_id: to,
    kind: 'corridor',
    bidirectional,
    created_at: null,
  }
}

describe('buildDeckGraph', () => {
  it('adds an edge on both sides for a bidirectional connection', () => {
    const graph = buildDeckGraph([conn(1, 2, 1)])
    expect(graph.adjacency[1]).toEqual([2])
    expect(graph.adjacency[2]).toEqual([1])
  })

  it('adds an edge only on the source side for a one-way connection', () => {
    const graph = buildDeckGraph([conn(1, 2, 0)])
    expect(graph.adjacency[1]).toEqual([2])
    expect(graph.adjacency[2]).toBeUndefined()
  })

  it('dedupes a neighbor listed by two parallel connections', () => {
    const graph = buildDeckGraph([conn(1, 2, 1), conn(2, 1, 1, 999)])
    expect(graph.adjacency[1]).toEqual([2])
    expect(graph.adjacency[2]).toEqual([1])
  })

  it('returns an empty adjacency for no connections', () => {
    expect(buildDeckGraph([])).toEqual({ adjacency: {} })
  })
})

describe('neighbors', () => {
  it('returns the one-hop rooms for a place', () => {
    const graph = buildDeckGraph([conn(1, 2, 1), conn(2, 3, 1)])
    expect(neighbors(graph, 2).sort((a, b) => a - b)).toEqual([1, 3])
  })

  it('returns an empty list for a place with no edges', () => {
    const graph = buildDeckGraph([conn(1, 2, 1)])
    expect(neighbors(graph, 3)).toEqual([])
  })
})

describe('isConnected', () => {
  it('is true when every place is reachable across bidirectional edges', () => {
    const graph = buildDeckGraph([conn(1, 2, 1), conn(2, 3, 1)])
    expect(isConnected(graph, [1, 2, 3])).toBe(true)
  })

  it('is false when a place is unreachable from the others', () => {
    const graph = buildDeckGraph([conn(1, 2, 1)])
    expect(isConnected(graph, [1, 2, 3])).toBe(false)
  })

  it('treats a one-way-only edge as connected when traversable from a start', () => {
    // bridge(1) -> ladder -> hold(2); hold cannot return, but the component is
    // still single because we treat reachability undirected for topology checks.
    const graph = buildDeckGraph([conn(1, 2, 0)])
    expect(isConnected(graph, [1, 2])).toBe(true)
  })

  it('is true for a single place', () => {
    expect(isConnected(buildDeckGraph([]), [1])).toBe(true)
  })

  it('is true for an empty manifest', () => {
    expect(isConnected(buildDeckGraph([]), [])).toBe(true)
  })

  it('is false for two disjoint pairs', () => {
    const graph = buildDeckGraph([conn(1, 2, 1), conn(3, 4, 1)])
    expect(isConnected(graph, [1, 2, 3, 4])).toBe(false)
  })
})

describe('orphanRooms', () => {
  it('lists places with no edges', () => {
    const graph = buildDeckGraph([conn(1, 2, 1)])
    // 3 is a med-bay nobody wired up.
    expect(orphanRooms(graph, [1, 2, 3])).toEqual([3])
  })

  it('lists places unreachable from the main component', () => {
    const graph = buildDeckGraph([conn(1, 2, 1), conn(3, 4, 1)])
    // The first listed place (1) anchors the main component; 3 and 4 are its
    // disconnected satellite.
    expect(orphanRooms(graph, [1, 2, 3, 4]).sort((a, b) => a - b)).toEqual([3, 4])
  })

  it('returns no orphans when the ship is fully connected', () => {
    const graph = buildDeckGraph([conn(1, 2, 1), conn(2, 3, 1)])
    expect(orphanRooms(graph, [1, 2, 3])).toEqual([])
  })

  it('returns no orphans for an empty manifest', () => {
    expect(orphanRooms(buildDeckGraph([]), [])).toEqual([])
  })
})
