// Structured journeys + arrival resolver (Track M). Transit is clock-law:
// characters leave, stay en route for real narrative minutes, then land.
// Pure + deterministic — no I/O. LLMs may propose intent to move; domain
// commits JourneyCommit rows and lands them via resolveArrivals.

import type { DeckGraph } from '@/domain/entities'
import { neighbors } from '@/domain/services/deck-graph'
import { minutesToWorldTime, tryParseWorldTime } from '@/domain/services/narrative-clock'

export type TravelMode = 'walk' | 'corridor' | 'vehicle' | 'unknown'
export type SpatialTravelMode = 'bounded' | 'open' | 'unknown'

export type JourneyCommit = {
  characterId: number
  fromPlaceId: number | null
  /** Final destination. */
  toPlaceId: number
  /**
   * Remaining hops including the final destination, excluding the room the
   * character is currently in. Empty after landing.
   */
  remainingPlaceIds: number[]
  departMinutes: number
  /** Absolute narrative-clock minutes when the *next hop* (or final) lands. */
  arriveMinutes: number
  mode: TravelMode
}

export type TravelRejectReason =
  | 'unknown_place'
  | 'already_there'
  | 'no_path'
  | 'invalid_clock'

export type StartJourneyResult =
  | { ok: true; journey: JourneyCommit }
  | { ok: false; reason: TravelRejectReason }

export type TravelerSnapshot = {
  characterId: number
  currentPlaceId: number | null
  inTransitToPlaceId: number | null
  /** Authoritative minute counter when present. */
  arrivalMinutes: number | null
  /** Free-text ETA fallback when arrivalMinutes is null. */
  arrivalWorldTime: string | null
  /** JSON or already-parsed remaining hop list (may be null). */
  journeyPath: number[] | null
}

export type ArrivalWrite = {
  characterId: number
  /** Place after this resolve step (hop or final). */
  currentPlaceId: number
  inTransitToPlaceId: number | null
  arrivalMinutes: number | null
  arrivalWorldTime: string | null
  remainingPlaceIds: number[]
  /** True when the journey fully completed this resolve. */
  landed: boolean
  lastKnownSituation: string | null
}

// ── Duration defaults (v1 tunable constants) ────────────────────────────────

/** Minutes per corridor edge on a bounded deck graph. */
export const BOUNDED_HOP_MINUTES = 3
/** Cap for a multi-hop bunker walk so small maps stay snappy. */
export const BOUNDED_JOURNEY_CAP_MINUTES = 30
/** Same-settlement open-world band (midpoint used). */
export const OPEN_SAME_SETTLEMENT_MINUTES = 20
/** Cross-district open-world band (midpoint used). */
export const OPEN_CROSS_DISTRICT_MINUTES = 90

export type EstimateTravelArgs = {
  spatialMode: SpatialTravelMode
  graph: DeckGraph | null
  fromPlaceId: number | null
  toPlaceId: number
  mode?: TravelMode
  /**
   * When true, treat from/to as different districts even without graph distance
   * (open-world coarse band). Default false → same-settlement band.
   */
  crossDistrict?: boolean
}

/**
 * Estimate travel duration in narrative minutes.
 * Bounded: hop count × BOUNDED_HOP_MINUTES (capped).
 * Open: same-settlement or cross-district band.
 * Unknown dest / no path: returns null (caller should reject, not invent).
 */
export function estimateTravelMinutes(args: EstimateTravelArgs): number | null {
  const mode = args.mode ?? 'unknown'
  if (args.fromPlaceId != null && args.fromPlaceId === args.toPlaceId) return 0

  if (args.spatialMode === 'bounded' && args.graph) {
    if (args.fromPlaceId == null) {
      // No origin: single short hop into known space (seed / first placement).
      return BOUNDED_HOP_MINUTES
    }
    const path = shortestPath(args.graph, args.fromPlaceId, args.toPlaceId)
    if (!path || path.length < 2) return null
    const hops = path.length - 1
    const raw =
      hops *
      (mode === 'vehicle' ? Math.max(1, Math.floor(BOUNDED_HOP_MINUTES / 2)) : BOUNDED_HOP_MINUTES)
    return Math.min(BOUNDED_JOURNEY_CAP_MINUTES, Math.max(BOUNDED_HOP_MINUTES, raw))
  }

  // Open / unknown topology: coarse bands only.
  if (args.crossDistrict) return OPEN_CROSS_DISTRICT_MINUTES
  return OPEN_SAME_SETTLEMENT_MINUTES
}

export type StartJourneyArgs = {
  characterId: number
  fromPlaceId: number | null
  toPlaceId: number
  clockMinutes: number
  spatialMode: SpatialTravelMode
  graph: DeckGraph | null
  mode?: TravelMode
  knownPlaceIds?: Set<number>
  crossDistrict?: boolean
}

/**
 * Commit a journey: destination + path + absolute arrive minutes for the
 * *next* hop (or final when single-hop / open-band).
 */
export function startJourney(args: StartJourneyArgs): StartJourneyResult {
  if (!Number.isFinite(args.clockMinutes)) {
    return { ok: false, reason: 'invalid_clock' }
  }
  if (args.knownPlaceIds && !args.knownPlaceIds.has(args.toPlaceId)) {
    return { ok: false, reason: 'unknown_place' }
  }
  if (args.fromPlaceId != null && args.fromPlaceId === args.toPlaceId) {
    return { ok: false, reason: 'already_there' }
  }

  const clock = Math.max(0, Math.floor(args.clockMinutes))
  let remainingPlaceIds: number[] = [args.toPlaceId]
  let duration: number | null

  if (args.spatialMode === 'bounded' && args.graph && args.fromPlaceId != null) {
    const path = shortestPath(args.graph, args.fromPlaceId, args.toPlaceId)
    if (!path || path.length < 2) return { ok: false, reason: 'no_path' }
    // Path includes origin; remaining is every hop after origin.
    remainingPlaceIds = path.slice(1)
    const hopMinutes =
      (args.mode === 'vehicle'
        ? Math.max(1, Math.floor(BOUNDED_HOP_MINUTES / 2))
        : BOUNDED_HOP_MINUTES)
    duration = hopMinutes // next hop only; multi-hop re-schedules on resolve
  } else {
    duration = estimateTravelMinutes({
      spatialMode: args.spatialMode,
      graph: args.graph,
      fromPlaceId: args.fromPlaceId,
      toPlaceId: args.toPlaceId,
      mode: args.mode,
      crossDistrict: args.crossDistrict,
    })
    if (duration == null) return { ok: false, reason: 'no_path' }
    // Open-world: single abstract leg to dest (no intermediate rooms).
    remainingPlaceIds = [args.toPlaceId]
  }

  // Adjacent / zero duration: still a journey of at least 1 minute so presence
  // is never same-tick teleport except seed/create paths that skip this service.
  const travelMinutes = Math.max(1, duration)

  return {
    ok: true,
    journey: {
      characterId: args.characterId,
      fromPlaceId: args.fromPlaceId,
      toPlaceId: args.toPlaceId,
      remainingPlaceIds,
      departMinutes: clock,
      arriveMinutes: clock + travelMinutes,
      mode: args.mode ?? (args.spatialMode === 'bounded' ? 'corridor' : 'walk'),
    },
  }
}

/**
 * Resolve journeys whose next-hop arrive time is due. Multi-hop: advances
 * current_place to the next room and reschedules the following hop. Final hop
 * clears transit. Early clock keeps en_route unchanged (no write).
 */
export function resolveArrivals(args: {
  travelers: TravelerSnapshot[]
  clockMinutes: number
  /** Minutes per intermediate hop when rescheduling multi-hop (bounded). */
  hopMinutes?: number
  includeClockToken?: boolean
}): ArrivalWrite[] {
  const clock = Math.max(0, Math.floor(args.clockMinutes))
  const hopMin = args.hopMinutes ?? BOUNDED_HOP_MINUTES
  const includeClockToken = args.includeClockToken !== false
  const writes: ArrivalWrite[] = []

  for (const t of args.travelers) {
    if (t.inTransitToPlaceId == null) continue
    const arrive = resolveArrivalMinutes(t)
    if (arrive == null || clock < arrive) continue

    const remaining =
      t.journeyPath && t.journeyPath.length > 0
        ? [...t.journeyPath]
        : [t.inTransitToPlaceId]

    const nextPlace = remaining[0]!
    const rest = remaining.slice(1)

    if (rest.length === 0) {
      // Final landing.
      writes.push({
        characterId: t.characterId,
        currentPlaceId: nextPlace,
        inTransitToPlaceId: null,
        arrivalMinutes: null,
        arrivalWorldTime: null,
        remainingPlaceIds: [],
        landed: true,
        lastKnownSituation: `just arrived`,
      })
    } else {
      // Intermediate hop — still en route toward final.
      const nextArrive = clock + hopMin
      const eta = minutesToWorldTime(nextArrive, { includeClockToken }).worldTime
      writes.push({
        characterId: t.characterId,
        currentPlaceId: nextPlace,
        inTransitToPlaceId: rest[rest.length - 1]!,
        arrivalMinutes: nextArrive,
        arrivalWorldTime: eta,
        remainingPlaceIds: rest,
        landed: false,
        lastKnownSituation: `in transit between rooms`,
      })
    }
  }

  return writes
}

/** Prefer structured minutes; fall back to strict free-text parse. */
export function resolveArrivalMinutes(t: {
  arrivalMinutes: number | null
  arrivalWorldTime: string | null
}): number | null {
  if (t.arrivalMinutes != null && Number.isFinite(t.arrivalMinutes)) {
    return Math.max(0, Math.floor(t.arrivalMinutes))
  }
  if (!t.arrivalWorldTime) return null
  const parsed = tryParseWorldTime(t.arrivalWorldTime)
  return parsed.ok ? parsed.minutes : null
}

/**
 * Serialize remaining path for persistence (null when empty / not en route).
 */
export function serializeJourneyPath(path: number[] | null | undefined): string | null {
  if (!path || path.length === 0) return null
  return JSON.stringify(path)
}

export function parseJourneyPath(raw: string | number[] | null | undefined): number[] | null {
  if (raw == null) return null
  if (Array.isArray(raw)) {
    return raw.filter((n) => Number.isFinite(n)).map((n) => Math.floor(n))
  }
  const text = String(raw).trim()
  if (!text) return null
  try {
    const v = JSON.parse(text) as unknown
    if (!Array.isArray(v)) return null
    return v
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
      .map((n) => Math.floor(n))
  } catch {
    return null
  }
}

/**
 * BFS shortest path (place ids) from `from` to `to`, inclusive of both ends.
 * Returns null when unreachable. Undirected via deck-graph neighbors().
 */
export function shortestPath(
  graph: DeckGraph,
  from: number,
  to: number,
): number[] | null {
  if (from === to) return [from]
  const queue: number[] = [from]
  const parent = new Map<number, number | null>([[from, null]])
  while (queue.length > 0) {
    const cur = queue.shift() as number
    for (const next of neighbors(graph, cur)) {
      if (parent.has(next)) continue
      parent.set(next, cur)
      if (next === to) {
        // Reconstruct
        const path: number[] = [to]
        let p: number | null | undefined = cur
        while (p != null) {
          path.push(p)
          p = parent.get(p) ?? null
        }
        path.reverse()
        return path
      }
      queue.push(next)
    }
  }
  return null
}

/**
 * One hop toward target along BFS parent pointer. Never long-jumps.
 * Returns current when already there / no path / null current with no target.
 */
export function nextHopToward(
  graph: DeckGraph,
  fromPlaceId: number | null,
  toPlaceId: number | null,
): number | null {
  if (toPlaceId == null) return fromPlaceId
  if (fromPlaceId == null) return toPlaceId
  if (fromPlaceId === toPlaceId) return fromPlaceId
  const path = shortestPath(graph, fromPlaceId, toPlaceId)
  if (!path || path.length < 2) return fromPlaceId
  return path[1]!
}

/**
 * Convert a journey commit into dual-store character field updates.
 */
export function journeyToCharacterFields(
  journey: JourneyCommit,
  options: { includeClockToken?: boolean } = {},
): {
  in_transit_to_place_id: number
  arrival_minutes: number
  arrival_world_time: string
  journey_path_json: string | null
} {
  const includeClockToken = options.includeClockToken !== false
  return {
    in_transit_to_place_id: journey.toPlaceId,
    arrival_minutes: journey.arriveMinutes,
    arrival_world_time: minutesToWorldTime(journey.arriveMinutes, {
      includeClockToken,
    }).worldTime,
    journey_path_json: serializeJourneyPath(journey.remainingPlaceIds),
  }
}

/**
 * Whether a character is still en route (must not stage as present at dest).
 */
export function isEnRoute(t: {
  in_transit_to_place_id: number | null
  arrival_minutes?: number | null
  arrival_world_time?: string | null
  clockMinutes: number
}): boolean {
  if (t.in_transit_to_place_id == null) return false
  const arrive = resolveArrivalMinutes({
    arrivalMinutes: t.arrival_minutes ?? null,
    arrivalWorldTime: t.arrival_world_time ?? null,
  })
  if (arrive == null) return true // unparseable ETA: treat as still travelling
  return t.clockMinutes < arrive
}
