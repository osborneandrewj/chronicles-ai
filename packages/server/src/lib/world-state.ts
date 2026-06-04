import type {
  Character,
  CharacterAgencyLevel,
  Place,
  Scene,
} from '@/domain/entities'
import { findLikelyDuplicateCharacters, type DuplicatePair } from '@/lib/character-dedup'
import {
  getActiveSceneForWorld,
  getCharactersForWorld,
  getCharactersInPlace,
  getLatestOccupancySnapshotRow,
  getPlace,
  getPlacesForWorld,
  getScenesForWorld,
  getStoryDossierForWorld,
  getTurnTimestampsForWorld,
  getWorldCursor,
  type OccupancySnapshotRow,
  type StoryDossier,
} from '@/lib/db'
import { inferPlaceProfile, type PlaceOccupancy } from '@/lib/place-population'
import { getReveriesForWorld, type ReverieRow } from '@/lib/reveries'
import { buildTurnNumberMap } from '@/lib/turn-numbers'

// Character / Place / Scene row TYPE defs now live in
// `domain/entities/character.ts` (spec §3.3); re-exported here for back-compat.
export type { Character, CharacterAgencyLevel, Place, Scene }

// Narrator-markdown renderers moved to the server/render layer (P4 — a
// rendering concern, not domain). Re-exported here so existing importers of
// `@/lib/world-state` keep working during the migration.
export {
  formatDossierBlock,
  formatOccupancyBlock,
  formatPlaceGeo,
  formatStateBlock,
  type NpcPlannedAction,
  type ReverieRenderContext,
} from '@/server/render/state-block'

// What the narrator's prompt actually needs each turn. The inspector reads
// the broader shape via getFullWorldState() — keep the two paths separate so
// the narrator doesn't get accidentally fattened with off-scene NPCs.
export type NarratorWorldState = {
  worldTime: string | null
  currentScene: Scene | null
  currentPlace: Place | null
  presentCharacters: Character[]
  knownCharacters: Character[]
  knownPlaces: Place[]
  dossier: StoryDossier
  occupancy: PlaceOccupancy | null
}

export type FullWorldState = {
  worldTime: string | null
  currentSceneId: number | null
  characters: Character[]
  places: Place[]
  scenes: Scene[]
  dossier: StoryDossier
  turnTimestamps: Record<number, string>
  turnNumbers: Record<number, number>
  potentialDuplicates: DuplicatePair[]
  reveriesByCharacter: Record<number, ReverieRow[]>
}

export function getNarratorWorldState(worldId: number): NarratorWorldState {
  const cursor = getWorldCursor(worldId)
  const activeScene = getActiveSceneForWorld(worldId)
  const currentPlace = activeScene?.place_id ? getPlace(activeScene.place_id) : null

  const knownCharacters = getCharactersForWorld(worldId)
  const knownPlaces = getPlacesForWorld(worldId)
  const player = knownCharacters.filter((c) => c.is_player === 1)
  const npcsInPlace = currentPlace
    ? getCharactersInPlace(worldId, currentPlace.id).filter((c) => c.is_player === 0)
    : []

  const occupancyRow = currentPlace ? getLatestOccupancySnapshotRow(worldId, currentPlace.id) : null
  const occupancy =
    occupancyRow && occupancyRow.scene_id === (activeScene?.id ?? null)
      ? parseOccupancyRow(occupancyRow)
      : null

  return {
    worldTime: cursor.world_time,
    currentScene: activeScene,
    currentPlace,
    presentCharacters: [...player, ...npcsInPlace],
    knownCharacters,
    knownPlaces,
    dossier: getStoryDossierForWorld(worldId),
    occupancy,
  }
}

// Deterministic scene tags for reverie flare-matching. Sources: the active
// place's profile match_tags (the same vocabulary the occupancy sim is built
// from) and the relevance tags of active story threads. Pure read of state.
export function collectSceneTags(state: NarratorWorldState): string[] {
  const tags: string[] = []
  if (state.currentPlace) {
    tags.push(...inferPlaceProfile({ name: state.currentPlace.name, kind: state.currentPlace.kind }).matchTags)
  }
  for (const thread of state.dossier.threads) {
    if (thread.status !== 'active') continue
    try {
      const parsed = JSON.parse(thread.relevance_tags_json ?? '[]')
      if (Array.isArray(parsed)) tags.push(...parsed.filter((t): t is string => typeof t === 'string'))
    } catch {
      // ignore malformed tag json
    }
  }
  return tags
}

export function getFullWorldState(worldId: number): FullWorldState {
  const cursor = getWorldCursor(worldId)
  const orderedTurns = getTurnTimestampsForWorld(worldId)
  const turnTimestamps = Object.fromEntries(
    orderedTurns.map((turn) => [turn.id, turn.created_at]),
  )
  const turnNumbers = buildTurnNumberMap(orderedTurns.map((turn) => turn.id))
  const characters = getCharactersForWorld(worldId)
  const reveriesByCharacter: Record<number, ReverieRow[]> = {}
  for (const r of getReveriesForWorld(worldId)) {
    ;(reveriesByCharacter[r.character_id] ??= []).push(r)
  }
  return {
    worldTime: cursor.world_time,
    currentSceneId: cursor.current_scene_id,
    characters,
    places: getPlacesForWorld(worldId),
    scenes: getScenesForWorld(worldId),
    dossier: getStoryDossierForWorld(worldId),
    turnTimestamps,
    turnNumbers,
    potentialDuplicates: findLikelyDuplicateCharacters(characters),
    reveriesByCharacter,
  }
}

// Minimal scene context for the classifier. The classifier doesn't need the
// full FIXED/OPEN framing or memorable_facts; it just needs to know whether
// the protagonist is in a scene with someone they could plausibly be
// addressing. "Where is the farmstead?" should classify as `say` +
// `in-character` when Armitage is present, and lean OOC when the protagonist
// is alone.
export function formatSceneDigestForClassifier(state: NarratorWorldState): string {
  const lines: string[] = []
  if (state.currentPlace) {
    lines.push(`PLACE: ${state.currentPlace.name}`)
  }
  const npcs = state.presentCharacters.filter((c) => c.is_player !== 1)
  if (npcs.length > 0) {
    lines.push(`PRESENT NPCS: ${npcs.map((c) => c.name).join(', ')}`)
  } else {
    lines.push('PRESENT NPCS: (none — the protagonist is alone)')
  }
  return lines.join('\n')
}


function parseOccupancyRow(row: OccupancySnapshotRow | null): PlaceOccupancy | null {
  if (!row) return null
  try {
    return JSON.parse(row.occupancy_json) as PlaceOccupancy
  } catch {
    return null
  }
}
