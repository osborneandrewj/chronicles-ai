import type {
  Character,
  CharacterAgencyLevel,
  OccupancySnapshotRow,
  Place,
  ReverieRow,
  Scene,
  StoryDossier,
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
import { inferPlaceProfile, type PlaceOccupancy } from '@/lib/place-population'
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
  type OpenOrderRenderContext,
  type PrivateUtteranceRenderContext,
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

// Read ports the narrator-context assembler needs each turn. The use case (or
// the strangled narrate-turn/opening-turn caller) hands these in from the
// container; the SQLite adapters delegate to the same `lib/db` readers the
// legacy path used, so the assembled state is byte-identical on SQLite.
export type NarratorWorldStateDeps = {
  worlds: Pick<WorldRepository, 'cursor'>
  scenes: Pick<SceneRepository, 'activeForWorld'>
  places: Pick<PlaceRepository, 'byId' | 'forWorld'>
  characters: Pick<CharacterRepository, 'forWorld' | 'inPlace'>
  occupancy: Pick<OccupancyRepository, 'latestSnapshot'>
  dossiers: Pick<DossierRepository, 'forWorld'>
}

// Port-driven narrator-context assembler. Only the row SOURCE is injected —
// no SQLite-direct twin (A0). SQLite adapters keep the path byte-green;
// Mongo adapters read the collections.
//
// Reads run in dependency waves so Mongo (network) pays 3 round-trips of
// parallel work instead of 8 sequential hops (Track A1).
export async function getNarratorWorldState(
  deps: NarratorWorldStateDeps,
  worldId: number,
): Promise<NarratorWorldState> {
  // Wave 1 — independent roots.
  const [cursor, activeScene, knownCharacters, knownPlaces, dossier] = await Promise.all([
    deps.worlds.cursor(worldId),
    deps.scenes.activeForWorld(worldId),
    deps.characters.forWorld(worldId),
    deps.places.forWorld(worldId),
    deps.dossiers.forWorld(worldId),
  ])

  const player = knownCharacters.filter((c) => c.is_player === 1)
  // Presence follows the PLAYER's physical location (current_place_id), not the
  // active scene's place. The two can drift — e.g. when the player walks back to
  // an earlier room in a bounded world and the scene transition lags — and when
  // they do, the narrator must still see whoever is in the room the player is
  // actually in, so a dormant NPC re-activates on return. Falls back to the
  // active scene's place, then null, when the player has no recorded place.
  const currentPlaceId = player[0]?.current_place_id ?? activeScene?.place_id ?? null

  // Wave 2 — needs currentPlaceId.
  const currentPlace = currentPlaceId ? await deps.places.byId(currentPlaceId) : null

  // Wave 3 — needs currentPlace (+ activeScene for occupancy scene match).
  const [npcsInPlace, occupancyRow] = currentPlace
    ? await Promise.all([
        deps.characters.inPlace(worldId, currentPlace.id).then((rows) =>
          rows.filter((c) => c.is_player === 0),
        ),
        deps.occupancy.latestSnapshot(worldId, currentPlace.id),
      ])
    : [[], null]

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
    dossier,
    occupancy,
  }
}

// Apply appearance/promotion deltas to an in-memory state snapshot so callers
// can skip a full re-read after recordAppearancesAndAutoPromote (Track A2).
// Only bumps present non-player characters (matching the SQL path).
export function applyPromotionDeltaToState(
  state: NarratorWorldState,
  promotion: { promoted: string[] },
  turnId: number,
): NarratorWorldState {
  const promoted = new Set(promotion.promoted)
  const presentIds = new Set(
    state.presentCharacters.filter((c) => c.is_player !== 1).map((c) => c.id),
  )
  const patchChar = (c: Character): Character => {
    if (!presentIds.has(c.id)) return c
    const appearance_count = c.appearance_count + 1
    const agency_level =
      promoted.has(c.name) && c.agency_level === 'npc'
        ? ('local' as Character['agency_level'])
        : c.agency_level
    return {
      ...c,
      appearance_count,
      last_seen_turn_id: turnId,
      agency_level,
    }
  }
  return {
    ...state,
    presentCharacters: state.presentCharacters.map(patchChar),
    knownCharacters: state.knownCharacters.map(patchChar),
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

// Port-driven full-state assembler for the inspector. No SQLite-direct twin (A0).
export async function getFullWorldState(
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
