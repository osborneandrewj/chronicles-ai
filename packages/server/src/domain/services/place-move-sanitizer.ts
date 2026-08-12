// Place-move sanitizer (Track M1). Archivist/NPC agent may propose current_place
// changes; domain converts NPC teleports into journeys (or rejects unknown
// destinations). Player moves may stay instant (player agency). Pure.

import type { DeckGraph } from '@/domain/entities'
import {
  journeyToCharacterFields,
  startJourney,
  type SpatialTravelMode,
  type TravelMode,
} from '@/domain/services/travel'

export type PlaceMoveCharacter = {
  id: number
  name: string
  is_player: number
  current_place_id: number | null
  in_transit_to_place_id: number | null
}

export type ProposedPlaceMove = {
  name: string
  /** Resolved destination place id (caller maps name → id). */
  toPlaceId: number
  /** When true, clear transit without relocating (abort). */
  abortJourney?: boolean
}

export type SanitizedPlaceWrite =
  | {
      kind: 'instant'
      characterId: number
      current_place_id: number
      in_transit_to_place_id: null
      arrival_minutes: null
      arrival_world_time: null
      journey_path_json: null
    }
  | {
      kind: 'journey'
      characterId: number
      // Keep current place until resolveArrivals lands them.
      in_transit_to_place_id: number
      arrival_minutes: number
      arrival_world_time: string
      journey_path_json: string | null
      last_known_situation?: string
    }
  | {
      kind: 'abort'
      characterId: number
      in_transit_to_place_id: null
      arrival_minutes: null
      arrival_world_time: null
      journey_path_json: null
    }
  | {
      kind: 'reject'
      characterId: number
      reason: string
    }

/**
 * Sanitize a proposed place change for one character.
 * - Player: instant move (clear transit).
 * - NPC same place: no-op reject.
 * - NPC different place: startJourney (never teleport write).
 * - abortJourney: clear transit fields only.
 */
export function sanitizePlaceMove(args: {
  character: PlaceMoveCharacter
  proposed: ProposedPlaceMove
  clockMinutes: number
  spatialMode: SpatialTravelMode
  graph: DeckGraph | null
  knownPlaceIds: Set<number>
  mode?: TravelMode
  includeClockToken?: boolean
}): SanitizedPlaceWrite {
  const { character, proposed } = args

  if (proposed.abortJourney) {
    return {
      kind: 'abort',
      characterId: character.id,
      in_transit_to_place_id: null,
      arrival_minutes: null,
      arrival_world_time: null,
      journey_path_json: null,
    }
  }

  if (!args.knownPlaceIds.has(proposed.toPlaceId)) {
    return { kind: 'reject', characterId: character.id, reason: 'unknown_place' }
  }

  if (character.current_place_id === proposed.toPlaceId) {
    // Already there — clear any stale transit.
    if (character.in_transit_to_place_id != null) {
      return {
        kind: 'abort',
        characterId: character.id,
        in_transit_to_place_id: null,
        arrival_minutes: null,
        arrival_world_time: null,
        journey_path_json: null,
      }
    }
    return { kind: 'reject', characterId: character.id, reason: 'already_there' }
  }

  // Player agency: instant relocation is allowed.
  if (character.is_player === 1) {
    return {
      kind: 'instant',
      characterId: character.id,
      current_place_id: proposed.toPlaceId,
      in_transit_to_place_id: null,
      arrival_minutes: null,
      arrival_world_time: null,
      journey_path_json: null,
    }
  }

  const started = startJourney({
    characterId: character.id,
    fromPlaceId: character.current_place_id,
    toPlaceId: proposed.toPlaceId,
    clockMinutes: args.clockMinutes,
    spatialMode: args.spatialMode,
    graph: args.graph,
    mode: args.mode,
    knownPlaceIds: args.knownPlaceIds,
  })

  if (!started.ok) {
    return {
      kind: 'reject',
      characterId: character.id,
      reason: started.reason,
    }
  }

  const fields = journeyToCharacterFields(started.journey, {
    includeClockToken: args.includeClockToken,
  })
  return {
    kind: 'journey',
    characterId: character.id,
    in_transit_to_place_id: fields.in_transit_to_place_id,
    arrival_minutes: fields.arrival_minutes,
    arrival_world_time: fields.arrival_world_time,
    journey_path_json: fields.journey_path_json,
    last_known_situation: `left for destination`,
  }
}

/**
 * Whether an NPC should be excluded from "present" because they are en route.
 */
export function excludeFromPresentWhileEnRoute(c: {
  in_transit_to_place_id: number | null
}): boolean {
  return c.in_transit_to_place_id != null
}
