import type {
  MetaStoryBible,
  PlayerModel,
  SimulationSession,
} from '@/domain/entities'
import type {
  BackgroundTasks,
  CharacterRepository,
  PlaceRepository,
  SceneRepository,
  SessionRepository,
  SimRunRepository,
  TurnRepository,
  WorldArchetypeProvider,
  WorldRepository,
} from '@/domain/ports'
import { returnToHub } from '@/application/use-cases/return-to-hub'
import { linkAntagonistCharacter } from '@/domain/services/link-antagonist'
import {
  refreshPlayerModelFromReport,
} from '@/domain/services/player-model'
import {
  buildDeterministicSimRunReport,
  type ExitKind,
} from '@/domain/services/sim-run-report'

// CloseSubworldAndReturn — single idempotent close path for sim → hub.
// Writes a deterministic compact SimRunReport (unique hub+subworld), returns
// the player via returnToHub, refreshes PlayerModel, and ensures antagonist link.

export type CloseSubworldAndReturnInput = {
  session: SimulationSession
  /** Subworld being closed; defaults to session.subworld_world_id. */
  subworldId?: number | null
  exitKind: ExitKind
  sourceTurnId: number | null
}

export type CloseSubworldAndReturnResult = {
  hubWorldId: number
  sceneId: number
  reportId: number | null
} | null

export type CloseSubworldAndReturnDeps = {
  worlds: WorldRepository
  places: PlaceRepository
  scenes: SceneRepository
  characters: CharacterRepository
  sessions: SessionRepository
  decks: WorldArchetypeProvider
  simRuns: SimRunRepository
  turns: TurnRepository
  backgroundTasks?: BackgroundTasks
}

function parseGenreTags(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function parseMetaStory(raw: string | null): MetaStoryBible | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as MetaStoryBible
  } catch {
    return null
  }
}

function parsePlayerModel(raw: string | null): PlayerModel | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as PlayerModel
  } catch {
    return null
  }
}

export async function closeSubworldAndReturn(
  input: CloseSubworldAndReturnInput,
  deps: CloseSubworldAndReturnDeps,
): Promise<CloseSubworldAndReturnResult> {
  const { session } = input
  const subworldId = input.subworldId ?? session.subworld_world_id
  if (subworldId == null) {
    // Still return to hub if possible
    const bare = await returnToHub({ session }, deps)
    return bare ? { ...bare, reportId: null } : null
  }

  const hubWorldId = session.hub_world_id
  const subworld = await deps.worlds.getWorld(subworldId)
  const codename = subworld?.name?.trim() || 'Unnamed protocol'
  const genreTags = parseGenreTags(subworld?.genre_tags ?? null)

  const recent = await deps.turns.recentTurns(subworldId, 8)
  const places = await deps.places.forWorld(subworldId)
  const placeNames = places.map((p) => p.name).filter(Boolean)

  const stub = buildDeterministicSimRunReport({
    codename,
    exitKind: input.exitKind,
    genreTags,
    sourceTurnId: input.sourceTurnId,
    recentTurns: recent.map((t) => ({ role: t.role, content: t.content })),
    placeNames,
  })
  stub.hub_world_id = hubWorldId
  stub.subworld_id = subworldId

  const report = await deps.simRuns.upsertByRun(stub)

  // Player model refresh (cheap deterministic).
  const hub = await deps.worlds.getWorld(hubWorldId)
  const priorModel = parsePlayerModel(hub?.player_model_json ?? null)
  const updatedAt = new Date().toISOString()
  const nextModel = refreshPlayerModelFromReport({
    prior: priorModel,
    hubWorldId,
    report,
    exitKind: input.exitKind,
    updatedAt,
  })
  await deps.worlds.setPlayerModel(hubWorldId, JSON.stringify(nextModel))

  // Ensure antagonist is linked (idempotent).
  await ensureAntagonistLinked(hubWorldId, deps)

  const result = await returnToHub({ session }, deps)
  if (!result) return null
  return { ...result, reportId: report.id }
}

async function ensureAntagonistLinked(
  hubWorldId: number,
  deps: Pick<CloseSubworldAndReturnDeps, 'worlds' | 'characters' | 'places'>,
): Promise<void> {
  const hub = await deps.worlds.getWorld(hubWorldId)
  if (!hub) return
  const bible = parseMetaStory(hub.meta_story_json)
  const cast = await deps.characters.forWorld(hubWorldId)
  const decision = linkAntagonistCharacter({
    bible,
    hubCharacters: cast,
    existingAntagonistId: hub.antagonist_character_id,
  })

  if (decision.action === 'already_linked') {
    await deps.characters.setClearanceLevel(decision.characterId, 'antagonist')
    return
  }
  if (decision.action === 'match_existing') {
    await deps.characters.setClearanceLevel(decision.characterId, 'antagonist')
    await deps.worlds.setAntagonistCharacterId(hubWorldId, decision.characterId)
    return
  }
  if (decision.action === 'create') {
    const places = await deps.places.forWorld(hubWorldId)
    const home = places[0]?.id ?? null
    const { id } = await deps.characters.add({
      world_id: hubWorldId,
      name: decision.name,
      description: decision.description,
      is_player: 0,
      current_place_id: home,
      role: 'program leadership',
      active_goal: 'Maintain control of the simulation program',
      daily_loop: null,
    })
    await deps.characters.setClearanceLevel(id, 'antagonist')
    await deps.worlds.setAntagonistCharacterId(hubWorldId, id)
  }
}
