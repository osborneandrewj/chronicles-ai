// Pure next-room resolution for one NPC per tick (starship pre-sim P2 + Track M).
// Given a crew member's daily_loop (already resolved to target place ids per
// band by the use case) and the injected room adjacency, decide where that NPC
// moves this tick. Deterministic, no I/O — neighbours arrive as a function so
// this service stays a pure spatial decision.
//
// Track M1: never long-jump. Non-adjacent targets step one hop toward the
// destination via BFS parent pointer (when a full adjacency map is available)
// or stay put when only a neighborsOf function is supplied and the target is
// not adjacent.

import type { WorldTimeBand } from '@/domain/services/world-clock'

// daily_loop resolved to place ids: each band names the room this NPC is due in
// (a place id), or null/absent when the routine says nothing for that band.
export type ResolvedDailyLoop = Partial<Record<WorldTimeBand, number | null>>

export type NextPlaceArgs = {
  dailyLoop: ResolvedDailyLoop | null
  band: WorldTimeBand
  currentPlaceId: number | null
  neighborsOf: (placeId: number) => number[]
  /**
   * Optional full adjacency map for BFS one-hop toward a non-adjacent target.
   * When omitted, non-adjacent targets stay put (no teleport).
   */
  adjacency?: Record<number, number[]>
}

// Target = the room the loop assigns for this band. If already there or the
// target is unknown, stay. Otherwise step toward it: a neighbour is a direct
// hop; a non-adjacent target is ONE hop along the shortest path (never a
// long-jump teleport). The result is always one of {current, a neighbour of
// current} — or the target when current is null (spawn into routine).
export function nextPlaceId(args: NextPlaceArgs): number | null {
  const { band, currentPlaceId, dailyLoop, neighborsOf, adjacency } = args

  const target = dailyLoop?.[band] ?? null
  if (target === null) return currentPlaceId
  if (target === currentPlaceId) return currentPlaceId
  if (currentPlaceId === null) return target

  const neighbors = neighborsOf(currentPlaceId)
  if (neighbors.includes(target)) return target

  // Non-adjacent: one BFS hop toward target when we have a full adjacency map.
  if (adjacency) {
    const hop = bfsNextHop(adjacency, currentPlaceId, target)
    if (hop != null) return hop
  }

  // No path or no map: stay put — never teleport across the graph.
  return currentPlaceId
}

/** BFS parent-pointer: first hop from `from` toward `to`, or null if unreachable. */
export function bfsNextHop(
  adjacency: Record<number, number[]>,
  from: number,
  to: number,
): number | null {
  if (from === to) return from
  const queue: number[] = [from]
  const parent = new Map<number, number | null>([[from, null]])
  while (queue.length > 0) {
    const cur = queue.shift() as number
    for (const next of adjacency[cur] ?? []) {
      if (parent.has(next)) continue
      parent.set(next, cur)
      if (next === to) {
        // Walk back to the hop after `from`.
        let step: number = next
        let p: number | null | undefined = cur
        while (p != null && p !== from) {
          step = p
          p = parent.get(p) ?? null
        }
        return step
      }
      queue.push(next)
    }
  }
  return null
}
