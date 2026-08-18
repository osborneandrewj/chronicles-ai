import type {
  MetaStoryBible,
  PlayerModel,
  SimulationSession,
} from '@/domain/entities'
import type {
  BackgroundTasks,
  CharacterRepository,
  DossierRepository,
  DossierWriter,
  PlaceRepository,
  SceneRepository,
  SessionRepository,
  SimRunRepository,
  TurnRepository,
  WorldArchetypeProvider,
  WorldRepository,
} from '@/domain/ports'
import { returnToHub } from '@/application/use-cases/return-to-hub'
import { concludeSubworldDossier } from '@/domain/services/conclude-subworld-dossier'
import { linkAntagonistCharacter } from '@/domain/services/link-antagonist'
import { antagonistSpeechRegister } from '@/domain/services/speech-staging'
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
  /** Optional: when present, abandon active subworld dossier rows (Track A4). */
  dossiers?: DossierRepository
  dossierWriter?: DossierWriter
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

  // Track A4: abandon active subworld arcs so exit does not freeze eternals.
  if (deps.dossiers && deps.dossierWriter) {
    try {
      await concludeSubworldDossierWrites({
        subworldId,
        exitKind: input.exitKind,
        turnId: input.sourceTurnId,
        subworldName: codename,
        reportHeadline: report.headline,
        dossiers: deps.dossiers,
        dossierWriter: deps.dossierWriter,
        hubWorldId,
        hubWorlds: deps.worlds,
      })
    } catch (err) {
      console.error('[conclude-subworld-dossier]', err)
    }
  }

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

async function concludeSubworldDossierWrites(args: {
  subworldId: number
  exitKind: ExitKind
  turnId: number | null
  subworldName: string
  reportHeadline: string
  dossiers: DossierRepository
  dossierWriter: DossierWriter
  hubWorldId: number
  hubWorlds: WorldRepository
}): Promise<void> {
  const dossier = await args.dossiers.forWorld(args.subworldId)
  const plan = concludeSubworldDossier({
    threads: dossier.threads,
    objectives: dossier.objectives,
    exitKind: args.exitKind,
    turnId: args.turnId,
    subworldName: args.subworldName,
    reportHeadline: args.reportHeadline,
  })

  for (const w of plan.threadWrites) {
    const t = dossier.threads.find((x) => x.id === w.id)
    if (!t) continue
    await args.dossierWriter.updateThread({
      id: w.id,
      kind: t.kind,
      status: w.status,
      summary: t.summary,
      stakes: t.stakes,
      rewards: t.rewards,
      consequences: t.consequences,
      hidden: t.hidden,
      relevance_tags_json: t.relevance_tags_json,
      resolved_turn_id: w.resolved_turn_id,
    })
  }
  for (const w of plan.objectiveWrites) {
    const o = dossier.objectives.find((x) => x.id === w.id)
    if (!o) continue
    await args.dossierWriter.updateObjective({
      id: w.id,
      thread_id: o.thread_id,
      status: w.status,
      detail: o.detail,
      blocker: w.blocker,
      completed_turn_id: w.completed_turn_id,
    })
  }

  // Optional idempotent hub aftermath thread from the report.
  if (plan.hubAftermathTitle) {
    const hubDossier = await args.dossiers.forWorld(args.hubWorldId)
    const exists = hubDossier.threads.some(
      (t) => t.title.toLowerCase() === plan.hubAftermathTitle!.toLowerCase(),
    )
    if (!exists) {
      await args.dossierWriter.insertThread({
        world_id: args.hubWorldId,
        title: plan.hubAftermathTitle,
        kind: 'background',
        status: 'active',
        summary: plan.hubAftermathSummary,
        stakes: null,
        rewards: null,
        consequences: null,
        hidden: null,
        relevance_tags_json: '[]',
        source_turn_id: args.turnId,
      })
    }
  }
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
    await deps.characters.setSpeechRegisterIfEmpty(
      decision.characterId,
      antagonistSpeechRegister(bible?.antagonistSpeechRegister),
    )
    return
  }
  if (decision.action === 'match_existing') {
    await deps.characters.setClearanceLevel(decision.characterId, 'antagonist')
    await deps.worlds.setAntagonistCharacterId(hubWorldId, decision.characterId)
    await deps.characters.setSpeechRegisterIfEmpty(
      decision.characterId,
      antagonistSpeechRegister(bible?.antagonistSpeechRegister),
    )
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
    await deps.characters.setSpeechRegisterIfEmpty(
      id,
      antagonistSpeechRegister(bible?.antagonistSpeechRegister),
    )
  }
}
