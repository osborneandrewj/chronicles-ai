// Pure next-room resolution for one NPC per tick (starship pre-sim P2). Given a
// crew member's daily_loop (already resolved to target place ids per band by the
// use case) and the injected room adjacency, decide where that NPC moves this
// tick. Deterministic, no I/O, no deck-graph import — neighbours arrive as a
// function so this service stays a pure spatial decision.

import type { WorldTimeBand } from '@/domain/services/world-clock'

// daily_loop resolved to place ids: each band names the room this NPC is due in
// (a place id), or null/absent when the routine says nothing for that band.
export type ResolvedDailyLoop = Partial<Record<WorldTimeBand, number | null>>

export type NextPlaceArgs = {
  dailyLoop: ResolvedDailyLoop | null
  band: WorldTimeBand
  currentPlaceId: number | null
  neighborsOf: (placeId: number) => number[]
}

// Target = the room the loop assigns for this band. If already there or the
// target is unknown, stay. Otherwise step toward it: a neighbour is a direct
// hop; anything else teleports straight to the target (fine for a tiny ship).
// The result is always one of {current, a neighbour of current, the target} —
// never an arbitrary room.
export function nextPlaceId(args: NextPlaceArgs): number | null {
  const { band, currentPlaceId, dailyLoop, neighborsOf } = args

  const target = dailyLoop?.[band] ?? null
  if (target === null) return currentPlaceId
  if (target === currentPlaceId) return currentPlaceId
  if (currentPlaceId === null) return target

  const neighbors = neighborsOf(currentPlaceId)
  if (neighbors.includes(target)) return target

  // Not adjacent: teleport directly to the loop target.
  return target
}
