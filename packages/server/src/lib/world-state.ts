import type {
  Character,
  CharacterAgencyLevel,
  Place,
  Scene,
} from '@/domain/entities'
import type {
  CharacterRepository,
  DossierRepository,
  OccupancyRepository,
  PlaceRepository,
  ReverieRepository,
  SceneRepository,
  TurnRepository,
  WorldRepository,
} from '@/domain/ports'
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

// Read ports the narrator-context assembler needs each turn. The use case (or
// the strangled narrate-turn/opening-turn caller) hands these in from the
// container; the SQLite adapters delegate to the same `lib/db` readers the
// legacy sync path uses, so the assembled state is byte-identical.
export type NarratorWorldStateDeps = {
  worlds: Pick<WorldRepository, 'cursor'>
  scenes: Pick<SceneRepository, 'activeForWorld'>
  places: Pick<PlaceRepository, 'byId' | 'forWorld'>
  characters: Pick<CharacterRepository, 'forWorld' | 'inPlace'>
  occupancy: Pick<OccupancyRepository, 'latestSnapshot'>
  dossiers: Pick<DossierRepository, 'forWorld'>
}

// Port-driven twin of getNarratorWorldState. SAME assembly/dedup/formatting —
// only the row SOURCE changes (injected read ports instead of `@/lib/db`). The
// SQLite adapters delegate to the identical readers, so SQLite stays byte-green
// (P2 cutover); the Mongo adapters read the collections.
export async function getNarratorWorldStateVia(
  deps: NarratorWorldStateDeps,
  worldId: number,
): Promise<NarratorWorldState> {
  const cursor = await deps.worlds.cursor(worldId)
  const activeScene = await deps.scenes.activeForWorld(worldId)
  const currentPlace = activeScene?.place_id ? await deps.places.byId(activeScene.place_id) : null

  const knownCharacters = await deps.characters.forWorld(worldId)
  const knownPlaces = await deps.places.forWorld(worldId)
  const player = knownCharacters.filter((c) => c.is_player === 1)
  const npcsInPlace = currentPlace
    ? (await deps.characters.inPlace(worldId, currentPlace.id)).filter((c) => c.is_player === 0)
    : []

  const occupancyRow = currentPlace
    ? await deps.occupancy.latestSnapshot(worldId, currentPlace.id)
    : null
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
    dossier: await deps.dossiers.forWorld(worldId),
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

// Read ports the inspector's full-state assembler needs. Same delegation
// discipline as NarratorWorldStateDeps.
export type FullWorldStateDeps = {
  worlds: Pick<WorldRepository, 'cursor'>
  turns: Pick<TurnRepository, 'turnTimestamps'>
  characters: Pick<CharacterRepository, 'forWorld'>
  places: Pick<PlaceRepository, 'forWorld'>
  scenes: Pick<SceneRepository, 'forWorld'>
  dossiers: Pick<DossierRepository, 'forWorld'>
  reveries: Pick<ReverieRepository, 'forWorld'>
}

// Port-driven twin of getFullWorldState. SAME assembly — only the row SOURCE
// changes (injected read ports). SQLite stays byte-green via delegation.
export async function getFullWorldStateVia(
  deps: FullWorldStateDeps,
  worldId: number,
): Promise<FullWorldState> {
  const cursor = await deps.worlds.cursor(worldId)
  const orderedTurns = await deps.turns.turnTimestamps(worldId)
  const turnTimestamps = Object.fromEntries(
    orderedTurns.map((turn) => [turn.id, turn.created_at]),
  )
  const turnNumbers = buildTurnNumberMap(orderedTurns.map((turn) => turn.id))
  const characters = await deps.characters.forWorld(worldId)
  const reveriesByCharacter: Record<number, ReverieRow[]> = {}
  for (const r of await deps.reveries.forWorld(worldId)) {
    ;(reveriesByCharacter[r.character_id] ??= []).push(r)
  }
  return {
    worldTime: cursor.world_time,
    currentSceneId: cursor.current_scene_id,
    characters,
    places: await deps.places.forWorld(worldId),
    scenes: await deps.scenes.forWorld(worldId),
    dossier: await deps.dossiers.forWorld(worldId),
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
