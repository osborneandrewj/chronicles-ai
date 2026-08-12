// Apply resolveArrivals writes onto character rows (Track M). Pure decision of
// field patches; the caller persists via CharacterRepository.applyAgentNpcFields
// (or setPlace + transit fields). No I/O.

import {
  parseJourneyPath,
  resolveArrivals,
  serializeJourneyPath,
  type ArrivalWrite,
  type TravelerSnapshot,
} from '@/domain/services/travel'

export type ArrivalCharacterFields = {
  characterId: number
  current_place_id: number
  in_transit_to_place_id: number | null
  arrival_minutes: number | null
  arrival_world_time: string | null
  journey_path_json: string | null
  last_known_situation: string | null
}

export function travelersFromCharacters(
  characters: Array<{
    id: number
    current_place_id: number | null
    in_transit_to_place_id: number | null
    arrival_minutes?: number | null
    arrival_world_time: string | null
    journey_path_json?: string | null
  }>,
): TravelerSnapshot[] {
  return characters
    .filter((c) => c.in_transit_to_place_id != null)
    .map((c) => ({
      characterId: c.id,
      currentPlaceId: c.current_place_id,
      inTransitToPlaceId: c.in_transit_to_place_id,
      arrivalMinutes: c.arrival_minutes ?? null,
      arrivalWorldTime: c.arrival_world_time,
      journeyPath: parseJourneyPath(c.journey_path_json ?? null),
    }))
}

export function arrivalWritesToFields(writes: ArrivalWrite[]): ArrivalCharacterFields[] {
  return writes.map((w) => ({
    characterId: w.characterId,
    current_place_id: w.currentPlaceId,
    in_transit_to_place_id: w.inTransitToPlaceId,
    arrival_minutes: w.arrivalMinutes,
    arrival_world_time: w.arrivalWorldTime,
    journey_path_json: serializeJourneyPath(w.remainingPlaceIds),
    last_known_situation: w.lastKnownSituation,
  }))
}

/**
 * Compute arrival field patches for all en-route characters at this clock.
 */
export function computeArrivalPatches(args: {
  characters: Array<{
    id: number
    current_place_id: number | null
    in_transit_to_place_id: number | null
    arrival_minutes?: number | null
    arrival_world_time: string | null
    journey_path_json?: string | null
  }>
  clockMinutes: number
  hopMinutes?: number
  includeClockToken?: boolean
}): ArrivalCharacterFields[] {
  const writes = resolveArrivals({
    travelers: travelersFromCharacters(args.characters),
    clockMinutes: args.clockMinutes,
    hopMinutes: args.hopMinutes,
    includeClockToken: args.includeClockToken,
  })
  return arrivalWritesToFields(writes)
}

/**
 * Merge arrival patches into an in-memory character list (immutable).
 */
export function applyArrivalsToCharacters<
  T extends {
    id: number
    current_place_id: number | null
    in_transit_to_place_id: number | null
    arrival_world_time: string | null
    arrival_minutes?: number | null
    journey_path_json?: string | null
    last_known_situation: string | null
  },
>(characters: T[], patches: ArrivalCharacterFields[]): T[] {
  if (patches.length === 0) return characters
  const byId = new Map(patches.map((p) => [p.characterId, p]))
  return characters.map((c) => {
    const p = byId.get(c.id)
    if (!p) return c
    return {
      ...c,
      current_place_id: p.current_place_id,
      in_transit_to_place_id: p.in_transit_to_place_id,
      arrival_minutes: p.arrival_minutes,
      arrival_world_time: p.arrival_world_time,
      journey_path_json: p.journey_path_json,
      last_known_situation: p.last_known_situation ?? c.last_known_situation,
    }
  })
}
