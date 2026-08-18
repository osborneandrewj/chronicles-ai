import 'server-only'

import { xai } from '@ai-sdk/xai'
import {
  stepCountIs,
  streamText,
  type ModelMessage,
  type UIMessageChunk,
} from 'ai'

import type { NarrationContext, NarratorStream } from '@/application/use-cases/advance-turn'
import type { ResolvedOutcome } from '@/domain/entities/resolved-outcome'
import type { ConductorPort, ConductorUsage } from '@/domain/ports/conductor'
import type { InputMode, Stance } from '@/domain/services/action-classifier-rules'
import { ensureHubAntagonist } from '@/application/use-cases/ensure-hub-antagonist'
import { tickLivingWorld } from '@/application/use-cases/tick-living-world'
import { getContainer } from '@/composition/container'
import type { SimulationSession, TimelineEvent } from '@/domain/entities'
import type { CharacterRepository } from '@/domain/ports'
import { closeSubworldAndReturn } from '@/application/use-cases/close-subworld-and-return'
import {
  applyArrivalsToCharacters,
  computeArrivalPatches,
} from '@/domain/services/apply-arrivals'
import { findLikelyDuplicateCharacters } from '@/domain/services/character-dedup'
import {
  patchClosesSomething,
  shouldRunCloseBiasPass,
} from '@/domain/services/close-bias'
import { decideDirector, directorBeatToMetadata } from '@/domain/services/director'
import { resolveAgencyLock } from '@/domain/services/incapacitation'
import { applySettledFindingsToSnapshot } from '@/domain/services/settled-findings'
import {
  contestedFallback,
  isBindingOutcome,
  outcomeToMetadata,
  resolveOutcomeWithRules,
} from '@/domain/services/outcome-resolution'
import { shouldRunDirectorBrain } from '@/domain/services/director-brain-gate'
import { decideDirectorCloses } from '@/domain/services/director-lifecycle'
import {
  parseDirectorState,
  serializeDirectorState,
} from '@/domain/services/director-state'
import {
  beatDirectedEvent,
  npcReconcileEvents,
  objectiveCompletedEvent,
  outcomeResolvedEvent,
  threadClosedEvent,
} from '@/domain/services/world-event-log'
import {
  isConsoleCapablePlace,
  shouldInjectSimLogs,
  shouldShowSimIndex,
} from '@/domain/services/console-access'
import { parseClearanceLevel } from '@/domain/services/clearance'
import {
  formatAmbientSimIndexBlock,
  formatConsoleLogPullBlock,
  pickReportForQuery,
} from '@/domain/services/sim-run-report'
import { formatPlayerModelBlock } from '@/domain/services/player-model'
import { formatInfluencePacketBlock } from '@/domain/services/build-influence-packet'
import type { InfluencePacket, PlayerModel } from '@/domain/entities'
import { clusterSimArcs, type SimArc } from '@/domain/services/cluster-sim-arcs'
import { detectSubworldExit } from '@/domain/services/detect-subworld-exit'
import {
  ARCHIVIST_EXTRACT_WINDOW_ROLE_ROWS,
  assistantTurnsSinceLastSuccessfulArchivist,
  selectArchivistExtractWindow,
  shouldRunArchivistLlmWithLag,
} from '@/domain/services/archivist-run-policy'
import {
  isOocPolicyRefusal,
  sanitizeNarratorHistory,
} from '@/domain/services/ooc-refusal'
import { lucidityDelta, lucidityStage } from '@/domain/services/lucidity'
import {
  estimateTurnMinutes,
  hasExplicitTimeJump,
  mergeElapsedMinutes,
  minutesToWorldTime,
  resolveClockMinutes,
} from '@/domain/services/narrative-clock'
import {
  shouldSpeculateNpcAgent,
  shouldTickNpcAgent,
} from '@/domain/services/npc-agent-gating'
import {
  deriveActiveOpenOrder,
  formatOpenOrderStatusLine,
  openOrderToMetadata,
  type OpenOrder,
} from '@/domain/services/open-order'
import {
  detectPrivateUtterance,
  privateUtteranceToMetadata,
  type PrivateUtterance,
} from '@/domain/services/private-utterance'
import { eraFromGenreTags, parseGenreTags } from '@/domain/services/occupancy-sim'
import { summarizePlanSalience } from '@/domain/services/plan-salience'
import { selectBleedThreads } from '@/domain/services/select-bleed-threads'
import { countActiveDossierRows } from '@/domain/services/closed-dossier'
import {
  hasRichStorySignal,
  shouldBootstrapThread,
  shouldRunArchivistLlm,
} from '@/domain/services/story-signal'
import { NARRATOR_MODEL } from '@/infrastructure/llm/model-registry'
import {
  ARCHIVIST_MODEL,
  applyArchivistPatch,
  constrainPlayerTravel,
  extractDeterministicPatch,
  extractPatch,
  extractWakePlace,
  mergeDeterministicTravel,
} from '@/lib/archivist'
import { classifyAction } from '@/lib/classifier'
import { reconcileNpcIntentsForTurn, RECONCILER_MODEL } from '@/lib/intent-reconciler'
import { narratorMapTools, shouldAttachNarratorMapTools } from '@/lib/map-tools'
import { formatNarratorTurnGuidance } from '@/lib/narrator-guidance'
import {
  applyNpcUpdatesToCharacters,
  NPC_AGENT_MODEL,
  persistNpcAgentDraft,
  planNpcActions,
  plansFromDraft,
  type NpcAgentDraft,
} from '@/lib/npc-agent'
import { buildPlaceOccupancySnapshot, type PlaceOccupancy } from '@/lib/place-population'
import { resolveUnresolvedPlaces } from '@/lib/place-resolver'
import { formatPremiseBlock, NARRATOR_BASE } from '@/lib/prompt'
import { computeReverieFlares } from '@/lib/reveries'
import {
  applyPromotionDeltaToState,
  collectSceneTags,
  formatDirectorBlock,
  formatResolvedOutcomeBlock,
  formatSceneDigestForClassifier,
  formatStateBlock,
  getNarratorWorldState,
} from '@/lib/world-state'

// Infrastructure NarratorPort adapter (spec §3.5, §5.1-P5). Owns the AI-SDK
// (`streamText`/`onFinish`/`toUIMessageStream`) AND the dense SQL+SDK pipeline
// body the god endpoint used to inline. AdvanceTurn injects this as
// `buildNarration`; it receives the gated, deduped, player-turn-persisted
// context and returns the `NarratorStream {chunks, completion}` value.
//
// PRESERVES EXACTLY: fail-open vs fail-closed (npc-agent / occupancy / geocoder
// / reverie-stamp / archivist / dedup stay console.error+continue); the
// `dbTurnId` flush-after-onFinish ordering (`completion` resolves only after the
// source stream drains, which happens after onFinish has persisted the turn);
// the background-task registration of the archivist promise (drain on SIGTERM).

// Prior role rows the narrator sees as full prose (user + assistant). The
// current player turn is included in the fetch and then dropped via
// priorHistory = allRecent.slice(0, -1), so fetch limit is prior + 1.
const NARRATOR_PRIOR_ROLE_ROWS = 20
const NARRATOR_HISTORY_FETCH = NARRATOR_PRIOR_ROLE_ROWS + 1
// How many prior off-screen sim beats to surface as the soft fallback advisory
// when no developing subplot is detected.
const OFF_SCREEN_BEATS = 2
// How many recent sim beats to read for arc clustering. Wider than the advisory
// so a multi-beat subplot (a forming conspiracy) can be detected and promoted
// rather than dropped after 2 loose beats (A7).
const SIM_ARC_WINDOW = 14
// Role-row lookback for lag math + extract-window truncation detection.
// Wider than ARCHIVIST_EXTRACT_WINDOW_ROLE_ROWS so we can see since-last-success
// overflow and stamp window_truncated rather than silently drop deferred prose.
const ARCHIVIST_LAG_LOOKBACK_ROLE_ROWS = 20

export async function narrateTurn(ctx: NarrationContext): Promise<NarratorStream> {
  const { worldId, playerText, activeSceneId, playerTurnId, backgroundTasks, world } = ctx
  const prestreamStartedAt = Date.now()
  const timingSpans: Record<string, number> = {}
  const mark = (name: string, started: number): void => {
    timingSpans[name] = Date.now() - started
  }

  // Read ports for the narrator-context assembler (P2 cutover) + the
  // non-archivist post-stream WRITE ports (P3 cutover: turns, reveries,
  // appearance/promotion bumps). The SQLite adapters delegate to the same
  // `lib/*` functions, so behavior is byte-identical; under PERSISTENCE=mongo
  // they read/write the collections.
  const {
    characters,
    clock,
    conductor,
    decks,
    directorBrain,
    dossiers,
    dossierWriter,
    drama,
    npcIntents,
    occupancy,
    placeConnections,
    places,
    relationships,
    reveries,
    scenes,
    sessions,
    simRuns,
    threadBootstrapper,
    timeline,
    timelineReader,
    timePassage,
    turns,
    unitOfWork,
    worldEvents,
    worlds,
  } = getContainer()
  const stateDeps = { characters, dossiers, occupancy, places, scenes, worlds }

  // State is read before the classifier so it can see who's present and where.
  // Single assembly (Track A2): later writes merge into this snapshot in memory.
  const stateReadStarted = Date.now()
  let priorState = await getNarratorWorldState(stateDeps, worldId)
  mark('state_ms', stateReadStarted)

  // Track M: land due journeys before promotion / agent / STATE see them.
  const clockMinutes = resolveClockMinutes({
    storedMinutes: world.ship_clock_minutes,
    worldTime: priorState.worldTime,
  })
  const arrivalStarted = Date.now()
  const arrivalPatches = computeArrivalPatches({
    characters: priorState.knownCharacters,
    clockMinutes,
    includeClockToken: world.spatial_mode === 'bounded',
  })
  if (arrivalPatches.length > 0) {
    for (const p of arrivalPatches) {
      try {
        await characters.applyAgentNpcFields(p.characterId, {
          current_place_id: p.current_place_id,
          in_transit_to_place_id: p.in_transit_to_place_id,
          arrival_minutes: p.arrival_minutes,
          arrival_world_time: p.arrival_world_time,
          journey_path_json: p.journey_path_json,
          last_known_situation: p.last_known_situation ?? undefined,
        })
      } catch (err) {
        console.error('[resolve-arrivals]', err)
      }
    }
    const knownAfter = applyArrivalsToCharacters(priorState.knownCharacters, arrivalPatches)
    // Re-derive present cast after landings (en-route excluded).
    const player = knownAfter.filter((c) => c.is_player === 1)
    const placeId = player[0]?.current_place_id ?? priorState.currentPlace?.id ?? null
    const presentNpcs = placeId
      ? knownAfter.filter(
          (c) =>
            c.is_player === 0 &&
            c.current_place_id === placeId &&
            c.in_transit_to_place_id == null,
        )
      : []
    priorState = {
      ...priorState,
      knownCharacters: knownAfter,
      presentCharacters: [...player, ...presentNpcs],
    }
  }
  mark('arrivals_ms', arrivalStarted)

  // Track A5: ensure hub antagonist linked on first hub turn if still null.
  if (world.world_layer === 'hub' && world.antagonist_character_id == null) {
    backgroundTasks.register(
      ensureHubAntagonist(worldId, { worlds, characters, places }).catch((err) => {
        console.error('[ensure-hub-antagonist]', err)
      }),
    )
  }

  // C2 A6-lite: launch classifier after first state read, parallel with
  // promotion / recent-turns / open-order. Await only before NPC agent gate.
  const classifyStarted = Date.now()
  const classificationPromise = classifyAction(
    playerText,
    formatSceneDigestForClassifier(priorState),
  ).then((result) => {
    mark('classifier_ms', classifyStarted)
    return result
  })

  // Update NPC attention tiers before the NPC agent call.
  const promoStarted = Date.now()
  const promotion = await characters.recordAppearancesAndAutoPromote(
    worldId,
    priorState.presentCharacters,
    playerTurnId,
  )
  let postPromotionState = applyPromotionDeltaToState(priorState, promotion, playerTurnId)
  mark('promotion_ms', promoStarted)

  try {
    const settled = applySettledFindingsToSnapshot(postPromotionState)
    postPromotionState = settled.next
    for (const w of settled.focusWrites) {
      await characters.applyAgentNpcFields(w.characterId, {
        ...(w.current_focus ? { current_focus: w.current_focus } : {}),
        ...(w.last_known_situation
          ? { last_known_situation: w.last_known_situation }
          : {}),
      })
      if (w.active_goal) {
        await characters.setActiveGoal(w.characterId, w.active_goal)
      }
    }
    for (const id of settled.dormantThreadIds) {
      const t = postPromotionState.dossier.threads.find((row) => row.id === id)
      if (!t) continue
      await dossierWriter.updateThread({
        id: t.id,
        kind: t.kind,
        status: 'dormant',
        summary: t.summary,
        stakes: t.stakes,
        rewards: t.rewards,
        consequences: t.consequences,
        hidden: t.hidden,
        relevance_tags_json: t.relevance_tags_json,
        resolved_turn_id: null,
      })
    }
  } catch (err) {
    console.error('[settled-findings]', err)
  }

  // Geocode off the critical path (Track A3). Comment already claimed
  // "never blocks the narrator"; now it actually doesn't. Resolution lands
  // one turn later — narrator does not read geo_status on first mention.
  if (world.spatial_mode !== 'bounded') {
    backgroundTasks.register(
      resolveUnresolvedPlaces({ places, worlds }, worldId).catch((err) => {
        console.error('[place-resolver pre-narrator]', err)
      }),
    )
  }

  // One recent-turns fetch for agent + narrator history.
  // Fetch includes the just-inserted current user turn; priorHistory drops it
  // so it is not duplicated with the pinned PLAYER ACTION message.
  const recentStarted = Date.now()
  const allRecent = await turns.recentTurns(worldId, NARRATOR_HISTORY_FETCH)
  const recentForAgents = allRecent.slice(-4)
  const priorHistory = allRecent.slice(0, -1)
  mark('recent_turns_ms', recentStarted)

  // S2 — open order: derive from recent user content + current text (TTL + yield
  // refresh). Durable write onto the player turn via mergeMetadata. Pre-stream
  // so guidance + STATE + NPC agent all see the same pending order.
  const presentIds = new Set(
    postPromotionState.presentCharacters
      .filter((c) => c.is_player !== 1)
      .map((c) => c.id),
  )
  const knownForOrder = postPromotionState.knownCharacters.map((c) => ({
    id: c.id,
    name: c.name,
    aliases: c.aliases,
    is_player: c.is_player,
    status: c.status,
  }))
  const recentUserTurns = allRecent
    .filter((t) => t.role === 'user')
    .map((t) => ({ id: t.id, content: t.content }))
  // Ensure current player turn is represented (it was just inserted).
  if (!recentUserTurns.some((t) => t.id === playerTurnId)) {
    recentUserTurns.push({ id: playerTurnId, content: playerText })
  }
  let activeOpenOrder: OpenOrder | null = deriveActiveOpenOrder(
    recentUserTurns,
    knownForOrder,
    {
      currentPlayerTurnId: playerTurnId,
      currentPlayerText: playerText,
      presentCharacterIds: presentIds,
    },
  )
  if (activeOpenOrder && activeOpenOrder.status !== 'expired') {
    backgroundTasks.register(
      turns.mergeMetadata(playerTurnId, 'open_order', openOrderToMetadata(activeOpenOrder)).catch(
        (err) => {
          console.error('[open-order metadata]', err)
        },
      ),
    )
  }

  // Private-channel audience: detect + durable stamp before agent / STATE / archivist.
  const activePrivateUtterance: PrivateUtterance | null = detectPrivateUtterance(
    playerText,
    knownForOrder,
    playerTurnId,
  )
  if (activePrivateUtterance) {
    backgroundTasks.register(
      turns
        .mergeMetadata(
          playerTurnId,
          'private_utterance',
          privateUtteranceToMetadata(activePrivateUtterance),
        )
        .catch((err) => {
          console.error('[private-utterance metadata]', err)
        }),
    )
  }

  // Open-order targets force an agent tick even when no present agents (S2).
  const forceAgentForOpenOrder =
    activeOpenOrder?.status === 'pending' && activeOpenOrder.targetCharacterId != null
  const npcAgentDeps = { characters, dossiers, npcIntents, places, reveries, unitOfWork, worlds }
  const era = eraFromGenreTags(parseGenreTags(world.genre_tags))
  const occupancyReuse =
    postPromotionState.occupancy != null &&
    postPromotionState.currentScene != null &&
    postPromotionState.currentPlace != null

  // Director before the NPC agent so CAST slots drive plan-cast (slice 3).
  // Pure; persist is best-effort and does not need to finish before Grok.
  const enRouteNames = postPromotionState.knownCharacters
    .filter((c) => c.in_transit_to_place_id != null)
    .map((c) => c.name)
  const lastAssistant = [...priorHistory].reverse().find((t) => t.role === 'assistant')
  let directorState = parseDirectorState(world.director_state_json)
  const agencyLock = resolveAgencyLock({
    playerText,
    recentAssistantText: lastAssistant?.content ?? null,
    persistedLocked: directorState.agencyLocked,
  })
  const directorDecision = decideDirector({
    threads: postPromotionState.dossier.threads,
    objectives: postPromotionState.dossier.objectives,
    clockMinutes,
    currentTurnId: playerTurnId,
    playerText,
    enRouteNames,
    presentCast: postPromotionState.presentCharacters.map((c) => ({
      id: c.id,
      name: c.name,
      isPlayer: c.is_player === 1,
    })),
    enRouteCast: postPromotionState.knownCharacters
      .filter((c) => c.in_transit_to_place_id != null)
      .map((c) => ({ id: c.id, name: c.name })),
    pendingBeat: directorState.pending,
    lastBeatKind: directorState.lastBeatKind,
    lastForegroundThreadId: directorState.lastForegroundThreadId,
    stallStreak: directorState.stallStreak,
    wakeAdvance: agencyLock.restoreAgency,
    collapsingThisTurn: agencyLock.collapsingThisTurn,
    stayUnder: agencyLock.stayUnder,
  })
  directorState = {
    ...directorState,
    pending: null,
    lastBeatKind: directorDecision.beatKind,
    lastForegroundThreadId: directorDecision.foregroundThreadId,
    stallStreak:
      directorDecision.beatKind === 'stall_escalate' ? directorState.stallStreak + 1 : 0,
    agencyLocked:
      agencyLock.collapsingThisTurn || (agencyLock.locked && agencyLock.stayUnder),
  }
  backgroundTasks.register(
    worlds.setDirectorState(worldId, serializeDirectorState(directorState)).catch((err) => {
      console.error('[director-state consume]', err)
    }),
  )

  const speculateAgent = shouldSpeculateNpcAgent({
    presentCharacters: postPromotionState.presentCharacters,
    pendingOpenOrder: forceAgentForOpenOrder,
  })
  const npcAgentPreload = {
    knownPlaces: postPromotionState.knownPlaces,
    knownCharacters: postPromotionState.knownCharacters,
    dossier: postPromotionState.dossier,
    worldTime: postPromotionState.worldTime,
    settingRegion: world.setting_region,
  }
  const occupancyPromise = occupancyReuse
    ? Promise.resolve(postPromotionState.occupancy)
    : buildPlaceOccupancySnapshot(
        { dossiers, occupancy, places, scenes, worlds },
        worldId,
        playerTurnId,
        era,
      ).catch((err) => {
        console.error('[place-population]', err)
        return null
      })
  const agentOccStarted = Date.now()
  const planPromise = speculateAgent
    ? planNpcActions(
        npcAgentDeps,
        worldId,
        playerTurnId,
        world.premise,
        playerText,
        recentForAgents,
        activeOpenOrder?.status === 'pending' ? activeOpenOrder : null,
        activePrivateUtterance,
        directorDecision.cast,
        npcAgentPreload,
      ).catch((err) => {
        console.error('[npc agent failed pre-narrator]', err)
        return { error: String(err) } as const
      })
    : Promise.resolve(null)

  // Await classifier (started after first state read) before conductor + persist gate.
  const classification = await classificationPromise
  const { stance, input_mode } = classification
  const conductorStarted = Date.now()
  const conductorPromise = settleConductorResolution(conductor, {
    playerText,
    stance,
    inputMode: input_mode,
    sceneDigest: formatSceneDigestForClassifier(priorState),
  })
  const shouldRunNpcAgent = shouldTickNpcAgent({
    stance,
    inputMode: input_mode,
    presentCharacters: postPromotionState.presentCharacters,
  })
  const keepNpcAgent = shouldRunNpcAgent || forceAgentForOpenOrder

  const [npcAgentSettled, occupancySettled, conductorSettled] = await Promise.all([
    planPromise,
    occupancyPromise,
    conductorPromise,
  ])
  mark('agent_occupancy_ms', agentOccStarted)
  mark('conductor_ms', conductorStarted)

  const npcAgentError =
    npcAgentSettled && 'error' in npcAgentSettled ? npcAgentSettled.error : null
  let npcAgentDraft: NpcAgentDraft | null =
    keepNpcAgent && npcAgentSettled && 'patch' in npcAgentSettled ? npcAgentSettled : null
  const discardedAgentUsage =
    !keepNpcAgent && npcAgentSettled && 'usage' in npcAgentSettled
      ? npcAgentSettled.usage
      : null
  let plans = npcAgentDraft ? plansFromDraft(npcAgentDraft) : []
  const turnOccupancy: PlaceOccupancy | null = occupancySettled
  const resolvedOutcome = conductorSettled.resolution
  if (isBindingOutcome(resolvedOutcome)) {
    backgroundTasks.register(
      turns
        .mergeMetadata(playerTurnId, 'conductor', {
          model: conductorSettled.model,
          method: conductorSettled.method,
          resolution: outcomeToMetadata(resolvedOutcome),
          usage: conductorSettled.usage,
        })
        .catch((err) => {
          console.error('[conductor metadata]', err)
        }),
    )
    const outcomeEvent = outcomeResolvedEvent({
      worldId,
      turnId: playerTurnId,
      worldTime: postPromotionState.worldTime,
      resolution: resolvedOutcome,
    })
    if (outcomeEvent) {
      backgroundTasks.register(
        worldEvents.append(outcomeEvent).catch((err) => {
          console.error('[conductor world-event]', err)
        }),
      )
    }
  }

  // Merge occupancy + in-memory NPC patch so STATE this turn matches the draft
  // before persistNpcAgentDraft runs post-stream.
  const placeIdByLower = new Map(
    postPromotionState.knownPlaces.map((p) => [p.name.toLowerCase(), p.id]),
  )
  const knownAfterPatch = npcAgentDraft
    ? applyNpcUpdatesToCharacters(
        postPromotionState.knownCharacters,
        placeIdByLower,
        npcAgentDraft.patch.npc_updates ?? [],
      )
    : postPromotionState.knownCharacters
  const playerAfter = knownAfterPatch.filter((c) => c.is_player === 1)
  const placeIdAfter =
    playerAfter[0]?.current_place_id ?? postPromotionState.currentPlace?.id ?? null
  const presentAfter = placeIdAfter
    ? knownAfterPatch.filter(
        (c) =>
          c.is_player === 0 &&
          c.current_place_id === placeIdAfter &&
          c.in_transit_to_place_id == null,
      )
    : []
  const narratorState = {
    ...postPromotionState,
    occupancy: turnOccupancy ?? postPromotionState.occupancy,
    knownCharacters: knownAfterPatch,
    presentCharacters: [...playerAfter, ...presentAfter],
  }
  const recentNarratorProse = recentForAgents
    .filter((t) => t.role === 'assistant')
    .map((t) => t.content)

  // Deterministic reverie flares — pure + free; stamping is best-effort.
  // Read through the port so Mongo prod actually flares (was SQLite-direct).
  const sceneTags = collectSceneTags(narratorState)
  const reverieNpcIds = narratorState.knownCharacters
    .filter((c) => c.is_player !== 1 && c.status !== 'dead')
    .map((c) => c.id)
  const reveriesByCharacter = await reveries.forCharacters(reverieNpcIds)
  const flareCandidates = [...reveriesByCharacter.values()].flat().map((r) => ({
    id: r.id,
    character_id: r.character_id,
    match_tags: r.match_tags,
    intensity: r.intensity,
    last_flared_turn_id: r.last_flared_turn_id,
  }))
  const presentNpcIds = narratorState.presentCharacters
    .filter((c) => c.is_player !== 1)
    .map((c) => c.id)
  const flaringReverieIds = computeReverieFlares(flareCandidates, sceneTags, {
    presentCharacterIds: presentNpcIds,
    currentTurnId: playerTurnId,
  })
  if (flaringReverieIds.length > 0) {
    backgroundTasks.register(
      reveries.stampFlared(flaringReverieIds, playerTurnId).catch((err) => {
        console.error('[reverie-flare]', err)
      }),
    )
  }

  // Pre-stream open-order STATUS (S2): system fact before streamText. Re-read
  // the target after the agent tick so last_known_situation / transit land in
  // STATE for this beat (living tick is post-stream and too late alone).
  let openOrderRender: {
    statusLines: string[]
    kind?: string
    targetName?: string
  } | null = null
  if (activeOpenOrder && activeOpenOrder.status === 'pending') {
    const placeNameById = new Map(narratorState.knownPlaces.map((p) => [p.id, p.name]))
    const target = narratorState.knownCharacters.find(
      (c) => c.id === activeOpenOrder!.targetCharacterId,
    )
    const presentNow =
      target != null &&
      (presentIds.has(target.id) ||
        (target.current_place_id != null &&
          narratorState.currentPlace?.id === target.current_place_id))
    const statusLine = formatOpenOrderStatusLine(
      activeOpenOrder,
      target
        ? {
            name: target.name,
            current_place_name: target.current_place_id
              ? placeNameById.get(target.current_place_id) ?? null
              : null,
            last_known_situation: target.last_known_situation,
            in_transit_to_name: target.in_transit_to_place_id
              ? placeNameById.get(target.in_transit_to_place_id) ?? null
              : null,
            arrival_world_time: target.arrival_world_time,
            present_with_protagonist: presentNow,
          }
        : null,
    )
    if (statusLine) {
      openOrderRender = {
        statusLines: [statusLine],
        kind: activeOpenOrder.kind,
        targetName: activeOpenOrder.targetName,
      }
    }
    if (presentNow && target) {
      activeOpenOrder = {
        ...activeOpenOrder,
        status: 'resolved',
        resolution: 'arrived',
      }
      backgroundTasks.register(
        turns
          .mergeMetadata(playerTurnId, 'open_order', openOrderToMetadata(activeOpenOrder))
          .catch((err) => {
            console.error('[open-order resolve metadata]', err)
          }),
      )
    }
  }

  const privateUtteranceRender =
    activePrivateUtterance && activePrivateUtterance.status === 'active'
      ? {
          channel: activePrivateUtterance.channel,
          audienceNames: activePrivateUtterance.audienceNames,
        }
      : null
  const directorBlock = formatDirectorBlock(
    directorDecision,
    narratorState.dossier.threads,
  )

  let stateBlock = formatStateBlock(
    narratorState,
    plans,
    recentNarratorProse,
    {
      byCharacter: reveriesByCharacter,
      flaring: new Set(flaringReverieIds),
    },
    openOrderRender,
    privateUtteranceRender,
  )
  if (directorBlock) {
    stateBlock = `${stateBlock}\n\n${directorBlock}`
  }
  const outcomeBlock = formatResolvedOutcomeBlock(resolvedOutcome)
  if (outcomeBlock) {
    stateBlock = `${stateBlock}\n\n${outcomeBlock}`
  }

  // Hub sim-ops: clearance-filtered index ambient; full body only at console gate.
  // Subworld influence packet (seeded once at enter) is a compact control channel.
  try {
    const hubSession =
      world.world_layer === 'hub' ? await sessions.byWorld(worldId) : null
    const hasAwoken = hubSession ? hubSession.has_awoken === 1 : false
    const playerClearance = parseClearanceLevel(
      narratorState.presentCharacters.find((c) => c.is_player === 1)?.clearance_level,
      'public_crew',
    )

    if (world.world_layer === 'hub' && shouldShowSimIndex({ worldLayer: 'hub', hasAwoken })) {
      const reports = await simRuns.forHub(worldId)
      let simRoomName: string | null = null
      if (world.template_id) {
        const archetype = await decks.getTemplate(world.template_id)
        simRoomName =
          archetype?.rooms.find((r) => r.key === archetype.simulationRoomKey)?.name ?? null
      }
      const consolePlace = isConsoleCapablePlace({
        placeName: narratorState.currentPlace?.name ?? null,
        simulationRoomName: simRoomName,
      })
      const decision = shouldInjectSimLogs({
        worldLayer: 'hub',
        placeId: narratorState.currentPlace?.id ?? null,
        placeName: narratorState.currentPlace?.name ?? null,
        isConsoleCapablePlace: consolePlace,
        playerText,
        actingCharacterClearance: playerClearance,
        hasAwoken,
      })
      // Ambient index always (post-awaken); body only when console gate opens.
      stateBlock += formatAmbientSimIndexBlock(reports, playerClearance)
      if (decision.inject && decision.mode === 'body' && reports.length > 0) {
        const picked = pickReportForQuery(reports, playerText)
        if (picked) {
          stateBlock += formatConsoleLogPullBlock(picked, playerClearance)
        }
      }
      // Player model only when antagonist is present (high clearance face).
      const antagonistPresent = narratorState.presentCharacters.some(
        (c) =>
          c.is_player !== 1 &&
          (c.id === world.antagonist_character_id ||
            parseClearanceLevel(c.clearance_level) === 'antagonist'),
      )
      if (antagonistPresent && world.player_model_json) {
        try {
          const model = JSON.parse(world.player_model_json) as PlayerModel
          stateBlock += `\n\n${formatPlayerModelBlock(model)}`
        } catch {
          // ignore malformed model
        }
      }
      stateBlock +=
        '\n\nSim log rule: staff only recite log facts present in STATE (index or body). Do not invent Sequence/protocol details that are not listed.'
    }

    if (world.world_layer === 'subworld' && world.influence_packet_json) {
      try {
        const packet = JSON.parse(world.influence_packet_json) as InfluencePacket
        stateBlock += `\n\n${formatInfluencePacketBlock(packet)}`
      } catch {
        // ignore
      }
    }
  } catch (err) {
    console.error('[hub-sim-ops state]', err)
  }

  const premiseBlock = formatPremiseBlock(world.premise)

  // OFF-SCREEN life (bounded worlds only). The during-play living tick runs
  // POST-stream, so the beats the narrator sees here are from PRIOR ticks — a
  // natural one-turn lag. We read a wider window and cluster it: when a subplot
  // is developing (the same characters recurring across several beats), promote
  // it to a prominent DEVELOPING SUBPLOT block so the narrator can dramatize it
  // — instead of dropping a fully-recorded conspiracy after 2 loose beats (A7).
  // Otherwise fall back to the soft advisory of the last couple of beats.
  // Best-effort: a read failure must never block the turn.
  const isBounded = world.spatial_mode === 'bounded'
  const offScreenNpcNames = narratorState.knownCharacters
    .filter((c) => c.is_player !== 1)
    .map((c) => c.name)
  const offScreenBlock = isBounded
    ? await timelineReader
        .recentSimEvents(worldId, SIM_ARC_WINDOW)
        .then((events) => {
          const arcs = clusterSimArcs(
            events.map((e) => ({ id: e.id, title: e.title, summary: e.summary })),
            offScreenNpcNames,
          )
          const arcBlock = formatSimArcBlock(arcs)
          return arcBlock || formatOffScreenBlock(events.slice(0, OFF_SCREEN_BEATS))
        })
        .catch((err) => {
          console.error('[off-screen sim beats]', err)
          return ''
        })
    : ''

  const historyMessages = buildHistoryMessages(priorHistory)
  const presentNpcCount = narratorState.presentCharacters.filter((c) => c.is_player !== 1).length
  const activeObjectiveTitles = narratorState.dossier.objectives
    .filter((o) => o.status === 'active' || o.status === 'blocked')
    .map((o) => o.title)
  const activeThreatTitles = narratorState.dossier.threads
    .filter((t) => t.status === 'active' && t.kind === 'threat')
    .map((t) => t.title)
  const primaryQuest = narratorState.dossier.threads.find(
    (t) => t.status === 'active' && t.kind === 'quest',
  )
  const planSalience = summarizePlanSalience(
    plans.map((p) => ({
      intent: p.intent,
      planned_action: p.planned_action,
      intent_type: p.intent_type,
      target_npc_name: p.target_npc_name,
      target_place_name: p.target_place_name,
    })),
    activeOpenOrder?.status === 'pending'
      ? {
          targetName: activeOpenOrder.targetName,
          targetCharacterId: activeOpenOrder.targetCharacterId,
          kind: activeOpenOrder.kind,
          status: activeOpenOrder.status,
        }
      : null,
  )
  const turnGuidance = formatNarratorTurnGuidance({
    stance,
    inputMode: input_mode,
    playerText,
    recentTurns: priorHistory,
    presentNpcCount,
    plannedActionCount: plans.length,
    plannedActions: plans.map((p) => ({
      intent: p.intent,
      planned_action: p.planned_action,
      intent_type: p.intent_type,
      target_npc_name: p.target_npc_name,
      target_place_name: p.target_place_name,
    })),
    planSalience,
    openOrder: activeOpenOrder,
    privateUtterance: activePrivateUtterance,
    wakeAdvance: agencyLock.restoreAgency,
    collapsingThisTurn: agencyLock.collapsingThisTurn,
    stayUnder: agencyLock.stayUnder,
    worldTime: narratorState.worldTime,
    activeObjectiveTitles,
    openClueTitles: narratorState.dossier.clues
      .filter((c) => c.status === 'open' || c.status === 'interpreted')
      .map((c) => c.title),
    activeThreatTitles,
    primaryPressureTitle:
      primaryQuest?.title ?? activeObjectiveTitles[0] ?? activeThreatTitles[0] ?? null,
  })

  // Reality-bending cue (Phase D) — subworlds only. Surface the lucidity stage
  // and any hub bleed motifs so the narrator can crack the simulation as the
  // player earns lucidity. The session is reused post-stream to bump lucidity.
  // Best-effort; never blocks the turn.
  let realityBlock = ''
  let subworldSession: SimulationSession | null = null
  if (world.world_layer === 'subworld') {
    try {
      subworldSession = await sessions.byWorld(worldId)
      if (subworldSession) {
        const stage = lucidityStage(subworldSession.lucidity)
        let bleed: string[] = []
        const hub = await worlds.getWorld(subworldSession.hub_world_id)
        if (hub?.meta_story_json) {
          try {
            const bible = JSON.parse(hub.meta_story_json) as { bleedMotifs?: string[] }
            bleed = selectBleedThreads(bible.bleedMotifs ?? [], { seed: worldId })
          } catch {
            // Malformed bible JSON — skip the bleed motifs, keep the stage cue.
          }
        }
        realityBlock = `\n\n### REALITY\nstage: ${stage}${
          bleed.length > 0 ? `\nbleed: ${bleed.join('; ')}` : ''
        }`
      }
    } catch (err) {
      console.error('[reality cue]', err)
    }
  }

  // Prompt layout for cache-friendly multi-turn (xAI prefix cache):
  //   [system = NARRATOR_BASE + PREMISE]  stable for a given world (cache hot)
  //   [...history...]                     append-only within the packer window
  //   [user = STATE + guidance + act]     only this message mutates per turn
  // Premise used to live in the trailing user message (always a full miss on
  // the large state block). Pinning it on system keeps the shared prefix
  // reusable across turns of the same world.
  // Phase B: omit empty TURN GUIDANCE entirely (no empty header).
  const guidanceSection = turnGuidance ? `\n\n${turnGuidance}` : ''
  const trailingUser: ModelMessage = {
    role: 'user',
    content: `${stateBlock}${offScreenBlock}${realityBlock}\n\nCLASSIFICATION: stance=${stance}, input_mode=${input_mode}${guidanceSection}\n\nPLAYER ACTION:\n${playerText}`,
  }
  const narratorSystem = `${NARRATOR_BASE}\n\n${premiseBlock}`
  const modelMessages: ModelMessage[] = [
    ...historyMessages,
    trailingUser,
  ]

  // C1: instrument pre-stream wall time + span breakdown before Grok starts.
  const prestreamMs = Date.now() - prestreamStartedAt
  timingSpans.prestream_ms = prestreamMs
  console.info('[prestream timing]', {
    worldId,
    playerTurnId,
    prestream_ms: prestreamMs,
    spans: timingSpans,
    classifier_method: classification.method,
    conductor_method: conductorSettled.method,
    npc_agent_ran: Boolean(npcAgentDraft),
    npc_agent_retried: npcAgentDraft?.retried ?? false,
    npc_agent_discarded: Boolean(discardedAgentUsage),
    arrivals_applied: arrivalPatches.length,
    occupancy_reused: occupancyReuse,
  })
  backgroundTasks.register(
    turns
      .mergeMetadata(playerTurnId, 'timing', {
        prestream_ms: prestreamMs,
        spans: timingSpans,
        classifier_method: classification.method,
        conductor_method: conductorSettled.method,
        npc_agent_ran: Boolean(npcAgentDraft),
        npc_agent_retried: npcAgentDraft?.retried ?? false,
        npc_agent_discarded: Boolean(discardedAgentUsage),
        arrivals_applied: arrivalPatches.length,
        occupancy_reused: occupancyReuse,
        ...(discardedAgentUsage ? { npc_agent_discarded_usage: discardedAgentUsage } : {}),
      })
      .catch((err) => {
        console.error('[prestream timing]', err)
      }),
  )

  // `completion` resolves with the persisted narrator turn id once onFinish has
  // run all post-stream work. It must settle ONLY after the source stream
  // drains — which the AI-SDK guarantees happens after onFinish — so the route's
  // `dbTurnId` metadata part lands last. We wire it through a deferred resolver
  // the flush stage settles.
  let resolveCompletion!: (id: number | undefined) => void
  const completion = new Promise<number | undefined>((resolve) => {
    resolveCompletion = resolve
  })
  let narratorTurnId: number | undefined
  const streamStartedAt = Date.now()
  let ttftMs: number | undefined
  const attachMapTools = shouldAttachNarratorMapTools(world.spatial_mode)

  const result = streamText({
    model: xai(NARRATOR_MODEL),
    system: narratorSystem,
    messages: modelMessages,
    ...(attachMapTools
      ? { tools: narratorMapTools, stopWhen: stepCountIs(2) }
      : {}),
    onFinish: async ({ text, usage: narratorUsage, toolResults }) => {
      const trimmed = text.trim()
      if (trimmed.length === 0) return
      // ── POST-STREAM transaction boundary: narrator turn + factual work ────
      const narratorTurn = await turns.insert(worldId, 'assistant', trimmed, activeSceneId)
      narratorTurnId = narratorTurn.id
      const streamDurationMs = Date.now() - streamStartedAt

      // OOC policy refusals are still shown in the chat log (what the model
      // emitted), but they must not drive archivist / clock / living-world work
      // and are redacted from *future* history packing via sanitizeNarratorHistory.
      if (isOocPolicyRefusal(trimmed)) {
        console.error(
          `[ooc-refusal] world=${worldId} turn=${narratorTurn.id} — model broke character; skipping factual pipeline`,
        )
        try {
          await turns.mergeMetadata(narratorTurn.id, 'narrator', {
            model: NARRATOR_MODEL,
            usage: narratorUsage,
            ooc_refusal: true,
          })
          await turns.mergeMetadata(narratorTurn.id, 'classifier', {
            model: classification.model,
            method: classification.method,
            classification: { stance, input_mode },
            usage: classification.usage,
            error: classification.error,
          })
          await turns.mergeMetadata(narratorTurn.id, 'timing', {
            prestream_ms: prestreamMs,
            stream_ms: streamDurationMs,
            ttft_ms: ttftMs ?? streamDurationMs,
            spans: timingSpans,
          })
        } catch (err) {
          console.error('[ooc-refusal metadata]', err)
        }
        return
      }

      if (npcAgentDraft) {
        try {
          plans = await persistNpcAgentDraft(
            npcAgentDeps,
            worldId,
            playerTurnId,
            npcAgentDraft,
          )
        } catch (err) {
          console.error('[npc agent persist]', err)
        }
      }

      try {
        await turns.mergeMetadata(narratorTurn.id, 'timing', {
          prestream_ms: prestreamMs,
          stream_ms: streamDurationMs,
          ttft_ms: ttftMs ?? streamDurationMs,
          spans: timingSpans,
          classifier_method: classification.method,
        })
      } catch (err) {
        console.error('[timing metadata]', err)
      }

      // NARRATIVE CLOCK (any world). Deterministic estimate is primary; LLM
      // time-passage runs only on explicit jump language (max merge, never sum).
      // Bounded worlds still couple clock → living tick; open/subworld get clock
      // only. Fail-open: a clock failure must never block the turn.
      try {
        const current = resolveClockMinutes({
          storedMinutes: world.ship_clock_minutes,
          worldTime: narratorState.worldTime,
          holdMinutes: 0,
        })
        const travelCue =
          /\b(walk|travel|ride|sail|head(?:s|ed)?\s+to|go\s+to|leave|depart|arrive|enter|reach)\b/i.test(
            playerText,
          ) ||
          /\b(arrive|arrives|arrived|enter|enters|entered|reach(?:es|ed)?|leave|leaves|left|depart)\b/i.test(
            trimmed,
          )
        const deterministic = estimateTurnMinutes({
          stance,
          sceneChanged: travelCue,
          travelled: travelCue,
          narrationLength: trimmed.length,
        })
        let llmMinutes: number | null = null
        if (hasExplicitTimeJump(trimmed)) {
          const { elapsedMinutes } = await timePassage.estimate({
            narration: trimmed,
            priorWorldTime: narratorState.worldTime,
          })
          llmMinutes = elapsedMinutes
        }
        const elapsed = mergeElapsedMinutes(deterministic, llmMinutes)
        const next = current + elapsed
        // Bounded: keep ~HH:MM token for ship-band round-trip. Open/subworld:
        // band-only phrase (no sci-fi clock HUD in Classical Greece).
        const { worldTime } = minutesToWorldTime(next, {
          includeClockToken: isBounded,
        })
        await worlds.setShipClockMinutes(worldId, next)
        await worlds.setWorldTime(worldId, worldTime)
      } catch (err) {
        console.error('[narrative-clock advance failed]', err)
      }

      // DURING-PLAY living tick (bounded worlds only). On a sealed ship ALL crew
      // stay active every turn, so we advance the OFF-scene crew one tick of the
      // pre-play sim machinery. Best-effort + fail-open. Open worlds keep the
      // turn pipeline's off-scene skip optimisation untouched.
      if (isBounded) {
        const livingTick = tickLivingWorld(
          {
            worldId,
            playerPlaceId: narratorState.currentPlace?.id ?? null,
            // The narrator turn id is the monotonic per-turn counter that anchors
            // the tick + cooldown. ~4 turns between off-screen beats keeps the ship
            // alive without spamming the timeline (or Haiku) every other turn.
            currentTick: narratorTurn.id,
            cooldownTicks: 4,
          },
          {
            characters,
            clock,
            drama,
            placeConnections,
            places,
            relationships,
            timeline,
            timelineReader,
            worlds,
          },
        ).catch((err) => {
          console.error('[living tick failed]', err)
        })
        backgroundTasks.register(livingTick)
      }

      const narratorMeta = {
        model: NARRATOR_MODEL,
        usage: narratorUsage,
        toolResults: toolResults.length > 0 ? toolResults : undefined,
      }
      const classifierMeta = {
        model: classification.model,
        method: classification.method,
        classification: { stance, input_mode },
        usage: classification.usage,
        error: classification.error,
      }
      const upfrontMeta: Record<string, unknown> = {
        narrator: narratorMeta,
        classifier: classifierMeta,
      }
      if (npcAgentDraft) {
        upfrontMeta.npc_agent = {
          model: NPC_AGENT_MODEL,
          usage: npcAgentDraft.usage,
          patch: npcAgentDraft.patch,
          retried: npcAgentDraft.retried,
        }
      } else if (npcAgentError) {
        upfrontMeta.npc_agent = { model: NPC_AGENT_MODEL, error: npcAgentError }
      } else if (discardedAgentUsage) {
        upfrontMeta.npc_agent = {
          model: NPC_AGENT_MODEL,
          usage: discardedAgentUsage,
          discarded: true,
        }
      }
      if (
        directorDecision.foregroundThreadId != null ||
        directorDecision.mustStage.length > 0
      ) {
        upfrontMeta.director = directorBeatToMetadata(directorDecision)
        const directed = beatDirectedEvent({
          worldId,
          turnId: narratorTurn.id,
          worldTime: narratorState.worldTime,
          decision: directorDecision,
        })
        if (directed) {
          try {
            await worldEvents.append(directed)
          } catch (err) {
            console.error('[world-event beat]', err)
          }
        }
      }
      if (promotion.promoted.length > 0) {
        upfrontMeta.npc_promotion = { promoted: promotion.promoted, tiers: promotion.tiers }
        console.log(`[npc promotion] world=${worldId} promoted=${promotion.promoted.join(', ')}`)
      } else if (Object.values(promotion.tiers).some((names) => names.length > 0)) {
        upfrontMeta.npc_promotion = { promoted: [], tiers: promotion.tiers }
      }
      // Disjoint top-level agent blocks — merging each key independently is
      // byte-identical to a single json_patch of the whole object.
      for (const [agentKey, block] of Object.entries(upfrontMeta)) {
        await turns.mergeMetadata(narratorTurn.id, agentKey, block as Record<string, unknown>)
      }

      let reconcileConfirmed = false
      // Reconcile NPC plans against the narrator's prose — best-effort.
      if (plans.length > 0) {
        try {
          const reconciliation = await reconcileNpcIntentsForTurn({
            playerTurnId,
            narratorTurnId: narratorTurn.id,
            narratorText: trimmed,
            characters,
            npcIntents,
          })
          await turns.mergeMetadata(narratorTurn.id, 'npc_intent_reconciler', {
            model: reconciliation.model,
            usage: reconciliation.usage,
            results: reconciliation.results,
            error: reconciliation.error,
            skipped: reconciliation.skipped,
          })
          reconcileConfirmed = reconciliation.results.some(
            (r) => r.disposition === 'staged' || r.disposition === 'modified',
          )
          const reconcileEvents = npcReconcileEvents({
            worldId,
            turnId: narratorTurn.id,
            worldTime: narratorState.worldTime,
            plans: plans.filter(
              (p): p is typeof p & { intent_id: number } => p.intent_id != null,
            ),
            results: reconciliation.results,
          })
          for (const event of reconcileEvents) {
            try {
              await worldEvents.append(event)
            } catch (err) {
              console.error('[world-event npc]', err)
            }
          }
        } catch (err) {
          await turns.mergeMetadata(narratorTurn.id, 'npc_intent_reconciler', {
            model: RECONCILER_MODEL,
            error: String(err),
          })
          console.error('[intent reconciler failed]', err)
        }
      }

      // Slice 4: close suggested threads/objectives when the brief asked and
      // prose (or a staged close beat) confirmed. Hygiene rides applyArchivistPatch.
      let directorClosedThisTurn = false
      const closePlan = decideDirectorCloses({
        beatKind: directorDecision.beatKind,
        foregroundThreadId: directorDecision.foregroundThreadId,
        suggestResolveThreadIds: directorDecision.suggestResolveThreadIds,
        suggestCompleteObjectiveIds: directorDecision.suggestCompleteObjectiveIds,
        threads: narratorState.dossier.threads,
        objectives: narratorState.dossier.objectives,
        playerText,
        narratorText: trimmed,
        reconcileConfirmed,
      })
      if (closePlan.threads.length > 0 || closePlan.objectives.length > 0) {
        try {
          await applyArchivistPatch(worldId, narratorTurn.id, {
            story_threads: closePlan.threads.map((t) => ({
              title: t.title,
              status: t.status,
            })),
            story_objectives: closePlan.objectives.map((o) => ({
              title: o.title,
              status: o.status,
            })),
          })
          directorClosedThisTurn = true
          for (const t of closePlan.threads) {
            await worldEvents.append(
              threadClosedEvent({
                worldId,
                turnId: narratorTurn.id,
                worldTime: narratorState.worldTime,
                threadId: t.id,
                status: t.status,
                title: t.title,
              }),
            )
          }
          for (const o of closePlan.objectives) {
            await worldEvents.append(
              objectiveCompletedEvent({
                worldId,
                turnId: narratorTurn.id,
                worldTime: narratorState.worldTime,
                objectiveId: o.id,
                status: o.status,
                title: o.title,
              }),
            )
          }
          await turns.mergeMetadata(narratorTurn.id, 'director_lifecycle', {
            threads: closePlan.threads,
            objectives: closePlan.objectives,
          })
        } catch (err) {
          console.error('[director-lifecycle]', err)
          await turns.mergeMetadata(narratorTurn.id, 'director_lifecycle', {
            error: String(err),
          })
        }
      }

      const brainReason = shouldRunDirectorBrain({
        pendingUnused: false,
        lastBrainTurnId: directorState.lastBrainTurnId,
        currentTurnId: narratorTurn.id,
        beatKind: directorDecision.beatKind,
        phase: directorDecision.phase,
        activeThreadCount: narratorState.dossier.threads.filter((t) => t.status === 'active')
          .length,
        activeObjectiveCount: narratorState.dossier.objectives.filter(
          (o) => o.status === 'active' || o.status === 'blocked',
        ).length,
        cast: directorDecision.cast,
        presentNpcCount: narratorState.presentCharacters.filter((c) => c.is_player !== 1)
          .length,
      })
      if (brainReason) {
        const fgTitle =
          directorDecision.foregroundThreadId != null
            ? (narratorState.dossier.threads.find(
                (t) => t.id === directorDecision.foregroundThreadId,
              )?.title ?? null)
            : null
        backgroundTasks.register(
          directorBrain
            .proposeNextBeat({
              reason: brainReason,
              premise: world.premise,
              playerText,
              narratorText: trimmed,
              threads: narratorState.dossier.threads.map((t) => ({
                id: t.id,
                title: t.title,
                kind: t.kind,
                summary: t.summary,
                status: t.status,
              })),
              present: narratorState.presentCharacters
                .filter((c) => c.is_player !== 1)
                .map((c) => ({ id: c.id, name: c.name })),
              lastDecision: {
                beatKind: directorDecision.beatKind,
                phase: directorDecision.phase,
                tension: directorDecision.tension,
                foregroundTitle: fgTitle,
                mustStage: directorDecision.mustStage,
                cast: directorDecision.cast,
              },
            })
            .then(async (proposed) => {
              if (!proposed) return
              await worlds.setDirectorState(
                worldId,
                serializeDirectorState({
                  ...directorState,
                  pending: {
                    ...proposed,
                    reason: brainReason,
                    sourceTurnId: narratorTurn.id,
                  },
                  lastBrainTurnId: narratorTurn.id,
                  lastBrainReason: brainReason,
                }),
              )
              await turns.mergeMetadata(narratorTurn.id, 'director_brain', {
                reason: brainReason,
                beatKind: proposed.beatKind,
                foregroundThreadId: proposed.foregroundThreadId,
              })
            })
            .catch((err) => {
              console.error('[director-brain]', err)
            }),
        )
      }

      // Subworld exit (C5/C6): in a simulation, a death or awakening surfaces
      // the player back into the hub's simulation room. Runs before the archivist
      // (which has early returns) so it always fires; fail-open so a hiccup never
      // blocks the turn.
      if (world.world_layer === 'subworld') {
        try {
          const exit = detectSubworldExit(playerText, trimmed)
          if (exit) {
            const session = await sessions.byWorld(worldId)
            if (session && session.status === 'in_subworld') {
              const closeResult = await closeSubworldAndReturn(
                {
                  session,
                  subworldId: worldId,
                  exitKind: exit.kind,
                  sourceTurnId: narratorTurn.id,
                },
                {
                  worlds,
                  places,
                  scenes,
                  characters,
                  sessions,
                  decks,
                  simRuns,
                  turns,
                  backgroundTasks,
                  dossiers,
                  dossierWriter,
                },
              )
              // Persist reportId so missing reports are diagnosable from turn metadata
              // (Meridian/Vigil: exit flipped session without a SimRunReport row).
              await turns.mergeMetadata(narratorTurn.id, 'subworld_exit', {
                kind: exit.kind,
                reportId: closeResult?.reportId ?? null,
                hubWorldId: closeResult?.hubWorldId ?? null,
              })
              if (closeResult?.reportId == null) {
                console.error(
                  `[subworld-exit] close returned without reportId world=${worldId} kind=${exit.kind}`,
                )
              }
            }
          }
        } catch (err) {
          console.error('[subworld-exit]', err)
        }
      }

      // Reality-bending track (Phase D, D1): a discovery / rule-violation beat
      // earns the player lucidity, escalating cracks -> affordances over time.
      // Best-effort; uses the session read pre-stream.
      if (subworldSession) {
        try {
          const delta = lucidityDelta(playerText, trimmed, subworldSession.lucidity)
          if (delta > 0) {
            await sessions.setLucidity(subworldSession.id, subworldSession.lucidity + delta)
          }
        } catch (err) {
          console.error('[lucidity bump]', err)
        }
      }

      const skipPlayerTravel =
        agencyLock.locked ||
        agencyLock.restoreAgency ||
        agencyLock.stayUnder ||
        agencyLock.collapsingThisTurn
      const wakePlace = agencyLock.restoreAgency
        ? extractWakePlace(
            trimmed,
            priorState.knownPlaces.map((p) => p.name),
          )
        : null
      const deterministicPatch = extractDeterministicPatch(
        priorState,
        playerText,
        trimmed,
        { skipPlayerTravel, wakePlace },
      )
      const activeDossierCount = countActiveDossierRows(priorState.dossier)
      const signal = shouldRunArchivistLlm(
        playerText,
        trimmed,
        !!deterministicPatch,
        activeDossierCount,
      )

      // Lag is computed after this narrator turn is inserted and before its
      // archivist block is written. Missing archivist metadata still counts.
      const recentForLag = await turns.recentTurns(worldId, ARCHIVIST_LAG_LOOKBACK_ROLE_ROWS)
      const assistantRows = recentForLag.filter((t) => t.role === 'assistant')
      let lagBefore = 0
      let lastSuccessTurnId: number | null = null
      if (assistantRows.length > 0) {
        const minId = assistantRows[0].id
        const maxIdExclusive = assistantRows[assistantRows.length - 1].id + 1
        const metaRows = await turns.assistantMetadataInRange(worldId, minId, maxIdExclusive)
        const metaById = new Map(metaRows.map((m) => [m.id, m.metadata]))
        const lagResult = assistantTurnsSinceLastSuccessfulArchivist(
          assistantRows.map((t) => ({
            id: t.id,
            metadata: metaById.get(t.id) ?? {},
          })),
        )
        lagBefore = lagResult.lag
        lastSuccessTurnId = lagResult.lastSuccessTurnId
      }
      const decision = shouldRunArchivistLlmWithLag({ signal, lag: lagBefore })

      if (!decision.run && deterministicPatch) {
        const travelSafe = skipPlayerTravel
          ? constrainPlayerTravel(deterministicPatch, wakePlace)
          : deterministicPatch
        await applyArchivistPatch(worldId, narratorTurn.id, travelSafe)
        await turns.mergeMetadata(narratorTurn.id, 'archivist', {
          model: 'deterministic-archivist',
          patch: travelSafe,
          lag_before: lagBefore,
        })
        runDupDetector(characters, worldId)
        return
      }
      if (!decision.run) {
        await turns.mergeMetadata(narratorTurn.id, 'archivist', {
          model: ARCHIVIST_MODEL,
          skipped: true,
          reason: 'no_state_change_signal',
          lag_before: lagBefore,
        })
        return
      }

      // Since-last-success window (capped). recentForLag is wide enough to
      // detect truncation beyond ARCHIVIST_EXTRACT_WINDOW_ROLE_ROWS.
      const extractSelection = selectArchivistExtractWindow({
        recentTurns: recentForLag,
        lastSuccessTurnId,
        cap: ARCHIVIST_EXTRACT_WINDOW_ROLE_ROWS,
      })
      const archivistRecent = extractSelection.window
      const activeThreadCount = priorState.dossier.threads.filter(
        (t) => t.status === 'active',
      ).length
      const bootstrapDossier = activeThreadCount === 0 && hasRichStorySignal(playerText, trimmed)
      const archivistPromise = extractPatch(
        world.premise,
        priorState,
        archivistRecent,
        turnOccupancy,
        false,
        bootstrapDossier,
        activePrivateUtterance,
      )
        .then(async ({ patch, usage: archivistUsage }) => {
          let merged = mergeDeterministicTravel(patch, deterministicPatch)
          if (skipPlayerTravel) {
            merged = constrainPlayerTravel(merged, wakePlace)
          }
          await applyArchivistPatch(worldId, narratorTurn.id, merged)
          const archivistMeta: Record<string, unknown> = {
            model: ARCHIVIST_MODEL,
            usage: archivistUsage,
            patch: merged,
            run_reason: decision.reason,
            lag_before: lagBefore,
          }
          if (extractSelection.windowTruncated) {
            archivistMeta.window_truncated = true
            if (extractSelection.windowStartTurnId != null) {
              archivistMeta.window_start_turn_id = extractSelection.windowStartTurnId
            }
            if (extractSelection.lastSuccessTurnId != null) {
              archivistMeta.last_success_turn_id = extractSelection.lastSuccessTurnId
            }
          }

          // Track A3: focused close-bias second pass when fiction resolved work
          // but the main extract opened freely without lifecycle closes.
          const activeBefore = countActiveDossierRows(priorState.dossier)
          const closeGate = shouldRunCloseBiasPass({
            playerText,
            narratorText: trimmed,
            activeDossierCount: activeBefore,
            mainPatchClosedSomething:
              patchClosesSomething(patch) || directorClosedThisTurn,
            directorSuggestsClose:
              directorDecision.suggestResolveThreadIds.length > 0 ||
              directorDecision.suggestCompleteObjectiveIds.length > 0,
          })
          if (closeGate) {
            try {
              const closePass = await extractPatch(
                world.premise,
                priorState,
                archivistRecent,
                turnOccupancy,
                false,
                false,
                activePrivateUtterance,
              )
              // Keep only lifecycle close fields from the second pass.
              const closeOnly = {
                story_threads: (closePass.patch.story_threads ?? []).filter(
                  (t) =>
                    t.status === 'resolved' ||
                    t.status === 'failed' ||
                    t.status === 'dormant',
                ),
                story_objectives: (closePass.patch.story_objectives ?? []).filter(
                  (o) => o.status === 'completed' || o.status === 'failed',
                ),
              }
              if (
                (closeOnly.story_threads?.length ?? 0) > 0 ||
                (closeOnly.story_objectives?.length ?? 0) > 0
              ) {
                await applyArchivistPatch(worldId, narratorTurn.id, closeOnly)
                archivistMeta.archivist_close = {
                  model: ARCHIVIST_MODEL,
                  usage: closePass.usage,
                  patch: closeOnly,
                }
              } else {
                archivistMeta.archivist_close = { skipped: true, reason: 'no_close_fields' }
              }
            } catch (err) {
              console.error('[archivist-close]', err)
              archivistMeta.archivist_close = { error: String(err) }
            }
          }

          await turns.mergeMetadata(narratorTurn.id, 'archivist', archivistMeta)

          // Thread-bootstrap fallback (C): Haiku reliably omits story_threads, so
          // when a bootstrap was warranted and the world STILL has no active
          // thread after the main patch, run the focused Grok bootstrapper and
          // persist its thread(s) through the same applyArchivistPatch path.
          if (bootstrapDossier) {
            const after = await dossiers.forWorld(worldId)
            const gate = shouldBootstrapThread({
              bootstrapWarranted: true,
              hasActiveThreadAfterApply: after.threads.some((t) => t.status === 'active'),
            })
            if (gate) {
              const bootstrapResult = await threadBootstrapper.bootstrap({
                premise: world.premise,
                recentNarration: archivistRecent
                  .map((t) => `${t.role === 'user' ? 'PLAYER' : 'NARRATOR'}: ${t.content}`)
                  .join('\n\n'),
                sceneTitle: priorState.currentScene?.title ?? null,
                placeName: priorState.currentPlace?.name ?? null,
              })
              if (bootstrapResult.threads.length > 0) {
                await applyArchivistPatch(worldId, narratorTurn.id, {
                  story_threads: bootstrapResult.threads.map((t) => ({
                    title: t.title,
                    kind: t.kind,
                    status: 'active' as const,
                    summary: t.summary,
                    stakes: t.stakes ?? undefined,
                    relevance_tags: t.relevanceTags,
                  })),
                })
                await turns.mergeMetadata(narratorTurn.id, 'thread_bootstrap', {
                  model: NARRATOR_MODEL,
                  threadCount: bootstrapResult.threads.length,
                })
              }
            }
          }

          runDupDetector(characters, worldId)
        })
        .catch(async (err) => {
          // Error does not reset lag; next turn may force via max_lag again.
          await turns.mergeMetadata(narratorTurn.id, 'archivist', {
            model: ARCHIVIST_MODEL,
            error: String(err),
            lag_before: lagBefore,
            run_reason: decision.reason,
          })
          console.error('[archivist patch failed]', err)
        })

      backgroundTasks.register(archivistPromise)
    },
  })

  // Forward the narrator UI stream verbatim; resolve `completion` with the real
  // DB turn id at flush — which fires only after the source stream closes (after
  // onFinish has persisted the turn and set narratorTurnId). The route appends
  // the dbTurnId metadata part after `completion` resolves, so it lands last.
  const chunks = result
    .toUIMessageStream()
    .pipeThrough(
      new TransformStream<UIMessageChunk, UIMessageChunk>({
        transform(chunk, controller) {
          if (
            ttftMs == null &&
            typeof chunk === 'object' &&
            chunk !== null &&
            'type' in chunk &&
            chunk.type === 'text-delta'
          ) {
            ttftMs = Date.now() - streamStartedAt
          }
          controller.enqueue(chunk)
        },
        flush() {
          resolveCompletion(narratorTurnId)
        },
      }),
    )

  return { chunks: chunks as ReadableStream<unknown>, completion }
}

function runDupDetector(characters: CharacterRepository, worldId: number): void {
  characters
    .forWorld(worldId)
    .then((chars) => {
      for (const d of findLikelyDuplicateCharacters(chars)) {
        console.warn(
          `[dup-detector] world ${worldId}: "${d.aName}" (#${d.aId}) ~ "${d.bName}" (#${d.bId}) — ${d.reason}`,
        )
      }
    })
    .catch((err) => {
      console.error('[dup-detector]', err)
    })
}

// Render the last few off-screen sim beats (newest first) as a compact narrator
// context block, oldest-first so the narrator reads them in chronological order.
// Returns '' when there are none, so the caller can concatenate unconditionally.
function formatOffScreenBlock(events: TimelineEvent[]): string {
  if (events.length === 0) return ''
  const lines = [...events]
    .reverse()
    .map((e) => `- ${e.title}: ${limitText(e.summary, 200)}`)
  return `\n\nOFF-SCREEN (elsewhere):\n${lines.join('\n')}`
}

// Promote detected off-screen subplots into a prominent, authoritative-toned
// block (A7). Unlike the loose advisory, this says "a real thread is developing
// off the page" so the narrator can let it intersect the player's path — while
// staying inside the protagonist's perception (no omniscient cutaways).
function formatSimArcBlock(arcs: SimArc[]): string {
  if (arcs.length === 0) return ''
  const lines: string[] = [
    '',
    '### DEVELOPING OFF-SCREEN SUBPLOTS (the world has moved while the player was elsewhere)',
    'These threads formed off the page. Let one surface when the player could plausibly notice, overhear, or intersect it — through evidence, a half-heard exchange, an NPC acting on it, or a consequence. Never narrate it omnisciently; stay inside the protagonist\'s perception.',
  ]
  for (const arc of arcs.slice(0, 2)) {
    const who = arc.participants.join(' & ')
    lines.push(`- ${who} (${arc.beatCount} beats):`)
    for (const summary of arc.summaries.slice(-3)) {
      lines.push(`  - ${limitText(summary, 180)}`)
    }
  }
  return `\n${lines.join('\n')}`
}

/**
 * Build narrator history messages: OOC/policy sanitization only, full content.
 * Compaction is intentionally off for the 20-prior-role-row window
 * (`history-packer` remains available for other callers / later re-enable).
 */
function buildHistoryMessages(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): ModelMessage[] {
  const sanitized = sanitizeNarratorHistory(history)
  return sanitized.map((turn) => ({ role: turn.role, content: turn.content }))
}

function limitText(value: string, max: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, max - 1).trimEnd()}...`
}

function emptyStream(): ReadableStream<unknown> {
  return new ReadableStream({
    start(controller) {
      controller.close()
    },
  })
}

type ConductorSettled = {
  resolution: ResolvedOutcome
  method: 'rules' | 'llm' | 'fallback'
  model: string
  usage?: ConductorUsage
}

function settleConductorResolution(
  port: ConductorPort,
  input: {
    playerText: string
    stance: Stance
    inputMode: InputMode
    sceneDigest: string
  },
): Promise<ConductorSettled> {
  const rules = resolveOutcomeWithRules({
    playerText: input.playerText,
    stance: input.stance,
    inputMode: input.inputMode,
  })
  if (rules) {
    return Promise.resolve({
      resolution: rules,
      method: 'rules',
      model: 'rule-based-conductor',
    })
  }
  return port
    .resolve({
      playerText: input.playerText,
      stance: input.stance,
      inputMode: input.inputMode,
      sceneDigest: input.sceneDigest,
    })
    .then((result) => {
      if (result) {
        return {
          resolution: result.resolution,
          method: 'llm' as const,
          model: result.model,
          usage: result.usage,
        }
      }
      return fallbackConductor(input.playerText)
    })
    .catch((err) => {
      console.error('[conductor]', err)
      return fallbackConductor(input.playerText)
    })
}

function fallbackConductor(playerText: string): ConductorSettled {
  return {
    resolution: contestedFallback(playerText),
    method: 'fallback',
    model: 'rule-based-conductor',
  }
}
