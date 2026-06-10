import 'server-only'

import { xai } from '@ai-sdk/xai'
import {
  stepCountIs,
  streamText,
  type ModelMessage,
  type UIMessageChunk,
} from 'ai'

import type { NarrationContext, NarratorStream } from '@/application/use-cases/advance-turn'
import { tickLivingWorld } from '@/application/use-cases/tick-living-world'
import { getContainer } from '@/composition/container'
import type { TimelineEvent } from '@/domain/entities'
import type { CharacterRepository } from '@/domain/ports'
import { returnToHub } from '@/application/use-cases/return-to-hub'
import { findLikelyDuplicateCharacters } from '@/domain/services/character-dedup'
import { clusterSimArcs, type SimArc } from '@/domain/services/cluster-sim-arcs'
import { detectSubworldExit } from '@/domain/services/detect-subworld-exit'
import { packNarratorHistory } from '@/domain/services/history-packer'
import { minutesToWorldTime, worldTimeToMinutes } from '@/domain/services/narrative-clock'
import { NARRATOR_MODEL } from '@/infrastructure/llm/model-registry'
import {
  ARCHIVIST_MODEL,
  applyArchivistPatch,
  extractDeterministicPatch,
  extractPatch,
} from '@/lib/archivist'
import { classifyAction } from '@/lib/classifier'
import { reconcileNpcIntentsForTurn, RECONCILER_MODEL } from '@/lib/intent-reconciler'
import { narratorMapTools } from '@/lib/map-tools'
import { formatNarratorTurnGuidance } from '@/lib/narrator-guidance'
import { NPC_AGENT_MODEL, runNpcAgentTick } from '@/lib/npc-agent'
import { buildPlaceOccupancySnapshotVia, type PlaceOccupancy } from '@/lib/place-population'
import { resolveUnresolvedPlaces } from '@/lib/place-resolver'
import { formatPremiseBlock, NARRATOR_BASE } from '@/lib/prompt'
import { computeReverieFlares, getReveriesForCharacters } from '@/lib/reveries'
import { hasRichStorySignal } from '@/lib/story-signal'
import {
  collectSceneTags,
  formatSceneDigestForClassifier,
  formatStateBlock,
  getNarratorWorldStateVia,
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

// How many recent turns to pull as candidates for the narrator's history. The
// budget packer below decides how many of these stay full vs. get compacted.
const NARRATOR_HISTORY_TURNS = 16
// Token budget for FULL-content history messages (≈4–5K of the narrator's 8K
// input). Narration is canonical, so full narrator turns are packed newest-first
// up to this budget before any get compacted (A5). ~4 chars ≈ 1 token.
const HISTORY_FULL_TOKEN_BUDGET = 4200
// Older turns that don't fit the full budget are compacted to this many chars.
const COMPACTED_TURN_CHARS = 600
// How many prior off-screen sim beats to surface as the soft fallback advisory
// when no developing subplot is detected.
const OFF_SCREEN_BEATS = 2
// How many recent sim beats to read for arc clustering. Wider than the advisory
// so a multi-beat subplot (a forming conspiracy) can be detected and promoted
// rather than dropped after 2 loose beats (A7).
const SIM_ARC_WINDOW = 14

export async function narrateTurn(ctx: NarrationContext): Promise<NarratorStream> {
  const { worldId, playerText, activeSceneId, playerTurnId, backgroundTasks } = ctx

  // Read ports for the narrator-context assembler (P2 cutover) + the
  // non-archivist post-stream WRITE ports (P3 cutover: turns, reveries,
  // appearance/promotion bumps). The SQLite adapters delegate to the same
  // `lib/*` functions, so behavior is byte-identical; under PERSISTENCE=mongo
  // they read/write the collections.
  const {
    characters,
    clock,
    decks,
    dossiers,
    drama,
    npcIntents,
    occupancy,
    placeConnections,
    places,
    relationships,
    reveries,
    scenes,
    sessions,
    timeline,
    timelineReader,
    timePassage,
    turns,
    unitOfWork,
    worlds,
  } = getContainer()
  const stateDeps = { characters, dossiers, occupancy, places, scenes, worlds }

  const world = await worlds.getWorld(worldId)
  // AdvanceTurn already gated world existence; this is a defensive re-read for
  // `premise`. If it somehow vanished, surface an empty stream.
  if (!world) {
    return { chunks: emptyStream(), completion: Promise.resolve(undefined) }
  }

  // State is read before the classifier so it can see who's present and where.
  const priorState = await getNarratorWorldStateVia(stateDeps, worldId)

  // Update NPC attention tiers before the NPC agent call.
  const promotion = await characters.recordAppearancesAndAutoPromote(
    worldId,
    priorState.presentCharacters,
    playerTurnId,
  )

  const classification = await classifyAction(
    playerText,
    formatSceneDigestForClassifier(priorState),
  )

  // Lazy real-world geocoding — best-effort, never blocks the narrator.
  // Bounded worlds are sealed fictional interiors (a ship, a facility, a
  // monastery); geocoding their rooms to real-world coordinates ("Bridge,
  // Canterbury, Kent") leaks real geography into a fictional space. Skip the
  // resolver entirely for bounded worlds so no Nominatim call ever fires.
  if (world.spatial_mode !== 'bounded') {
    await resolveUnresolvedPlaces({ places, worlds }, worldId).catch((err) => {
      console.error('[place-resolver pre-narrator]', err)
    })
  }

  // NPC agent failure must NEVER block the narrator — degrade to plan-less.
  const postPromotionState = await getNarratorWorldStateVia(stateDeps, worldId)
  const recentForAgents = await turns.recentTurns(worldId, 4)
  const { stance, input_mode } = classification
  const shouldRunNpcAgent = shouldTickNpcAgent(stance, input_mode, postPromotionState)
  const npcAgentDeps = { characters, npcIntents, places, reveries, unitOfWork, worlds }
  const npcAgentSettled = shouldRunNpcAgent
    ? await runNpcAgentTick(
        npcAgentDeps,
        worldId,
        playerTurnId,
        world.premise,
        playerText,
        recentForAgents,
      ).catch((err) => {
        console.error('[npc agent failed pre-narrator]', err)
        return { error: String(err) } as const
      })
    : null
  const npcAgentResult = npcAgentSettled && 'plans' in npcAgentSettled ? npcAgentSettled : null
  const npcAgentError = npcAgentSettled && 'error' in npcAgentSettled ? npcAgentSettled.error : null
  const plans = npcAgentResult?.plans ?? []

  // Deterministic occupancy snapshot — non-fatal.
  let turnOccupancy: PlaceOccupancy | null = null
  try {
    turnOccupancy = await buildPlaceOccupancySnapshotVia(
      { dossiers, occupancy, places, scenes, worlds },
      worldId,
      playerTurnId,
    )
  } catch (err) {
    console.error('[place-population]', err)
  }

  // Re-read so the just-persisted occupancy snapshot is visible.
  const narratorState = await getNarratorWorldStateVia(stateDeps, worldId)
  const recentNarratorProse = recentForAgents
    .filter((t) => t.role === 'assistant')
    .map((t) => t.content)

  // Deterministic reverie flares — pure + free; stamping is best-effort.
  const sceneTags = collectSceneTags(narratorState)
  const reverieNpcIds = narratorState.knownCharacters
    .filter((c) => c.is_player !== 1 && c.status !== 'dead')
    .map((c) => c.id)
  const reveriesByCharacter = getReveriesForCharacters(reverieNpcIds)
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
  try {
    await reveries.stampFlared(flaringReverieIds, playerTurnId)
  } catch (err) {
    console.error('[reverie-flare]', err)
  }

  const stateBlock = formatStateBlock(narratorState, plans, recentNarratorProse, {
    byCharacter: reveriesByCharacter,
    flaring: new Set(flaringReverieIds),
  })
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

  const allRecent = await turns.recentTurns(worldId, NARRATOR_HISTORY_TURNS)
  const priorHistory = allRecent.slice(0, -1)
  const historyMessages = compactHistory(priorHistory)
  const presentNpcCount = narratorState.presentCharacters.filter((c) => c.is_player !== 1).length
  const turnGuidance = formatNarratorTurnGuidance({
    stance,
    inputMode: input_mode,
    playerText,
    recentTurns: priorHistory,
    presentNpcCount,
    plannedActionCount: plans.length,
    worldTime: narratorState.worldTime,
    activeObjectiveTitles: narratorState.dossier.objectives
      .filter((o) => o.status === 'active' || o.status === 'blocked')
      .map((o) => o.title),
    openClueTitles: narratorState.dossier.clues
      .filter((c) => c.status === 'open' || c.status === 'interpreted')
      .map((c) => c.title),
    activeThreatTitles: narratorState.dossier.threads
      .filter((t) => t.status === 'active' && t.kind === 'threat')
      .map((t) => t.title),
  })

  const trailingUser: ModelMessage = {
    role: 'user',
    content: `${premiseBlock}\n\n${stateBlock}${offScreenBlock}\n\nCLASSIFICATION: stance=${stance}, input_mode=${input_mode}\n\n${turnGuidance}\n\nPLAYER ACTION:\n${playerText}`,
  }
  const modelMessages: ModelMessage[] = [
    { role: 'system', content: NARRATOR_BASE },
    ...historyMessages,
    trailingUser,
  ]

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

  const result = streamText({
    model: xai(NARRATOR_MODEL),
    messages: modelMessages,
    tools: narratorMapTools,
    stopWhen: stepCountIs(2),
    onFinish: async ({ text, usage: narratorUsage, toolResults }) => {
      const trimmed = text.trim()
      if (trimmed.length === 0) return
      // ── POST-STREAM transaction boundary: narrator turn + factual work ────
      const narratorTurn = await turns.insert(worldId, 'assistant', trimmed, activeSceneId)
      narratorTurnId = narratorTurn.id

      // DURING-PLAY living tick (bounded worlds only). On a sealed ship ALL crew
      // stay active every turn, so we advance the OFF-scene crew one tick of the
      // pre-play sim machinery (move toward band targets, gate/spend a drama beat,
      // drift relationships). Best-effort + fail-open like the other post-stream
      // enrichers — never blocks the turn; registered so it drains on SIGTERM.
      // Open worlds keep the turn pipeline's off-scene skip optimisation untouched.
      if (isBounded) {
        // PROSE-DRIVEN ship-clock (bounded worlds only, starship P6). Read the
        // just-written narration, estimate how much in-world time it covered, and
        // advance the ship-clock counter by that — so narrative time flows from
        // the STORY, not a fixed per-turn tick. Runs BEFORE the living tick so the
        // tick places crew against the freshly advanced band. Fail-open: a clock
        // failure must never block the turn (and the living tick still runs on the
        // prior band). Backfill the counter from world_time on first use (null).
        try {
          const current =
            world.ship_clock_minutes ?? worldTimeToMinutes(narratorState.worldTime)
          const { elapsedMinutes } = await timePassage.estimate({
            narration: trimmed,
            priorWorldTime: narratorState.worldTime,
          })
          const next = current + elapsedMinutes
          const { worldTime } = minutesToWorldTime(next)
          await worlds.setShipClockMinutes(worldId, next)
          await worlds.setWorldTime(worldId, worldTime)
        } catch (err) {
          console.error('[ship-clock advance failed]', err)
        }

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
      if (npcAgentResult) {
        upfrontMeta.npc_agent = {
          model: NPC_AGENT_MODEL,
          usage: npcAgentResult.usage,
          patch: npcAgentResult.patch,
        }
      } else if (npcAgentError) {
        upfrontMeta.npc_agent = { model: NPC_AGENT_MODEL, error: npcAgentError }
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
        } catch (err) {
          await turns.mergeMetadata(narratorTurn.id, 'npc_intent_reconciler', {
            model: RECONCILER_MODEL,
            error: String(err),
          })
          console.error('[intent reconciler failed]', err)
        }
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
              await returnToHub(
                { session },
                { worlds, places, scenes, characters, sessions, decks },
              )
              await turns.mergeMetadata(narratorTurn.id, 'subworld_exit', { kind: exit.kind })
            }
          }
        } catch (err) {
          console.error('[subworld-exit]', err)
        }
      }

      const deterministicPatch = extractDeterministicPatch(priorState, playerText, trimmed)
      const runArchivistLlm = shouldRunArchivistLlm(playerText, trimmed, !!deterministicPatch)

      if (!runArchivistLlm && deterministicPatch) {
        await applyArchivistPatch(worldId, narratorTurn.id, deterministicPatch)
        await turns.mergeMetadata(narratorTurn.id, 'archivist', {
          model: 'deterministic-archivist',
          patch: deterministicPatch,
        })
        runDupDetector(characters, worldId)
        return
      }
      if (!runArchivistLlm) {
        await turns.mergeMetadata(narratorTurn.id, 'archivist', {
          model: ARCHIVIST_MODEL,
          skipped: true,
          reason: 'no_state_change_signal',
        })
        return
      }

      const archivistRecent = (await turns.recentTurns(worldId, 4)).map((t) => ({
        role: t.role,
        content: t.content,
      }))
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
      )
        .then(async ({ patch, usage: archivistUsage }) => {
          await applyArchivistPatch(worldId, narratorTurn.id, patch)
          await turns.mergeMetadata(narratorTurn.id, 'archivist', {
            model: ARCHIVIST_MODEL,
            usage: archivistUsage,
            patch,
          })
          runDupDetector(characters, worldId)
        })
        .catch(async (err) => {
          await turns.mergeMetadata(narratorTurn.id, 'archivist', {
            model: ARCHIVIST_MODEL,
            error: String(err),
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

function compactHistory(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): ModelMessage[] {
  const packed = packNarratorHistory(history, {
    fullTokenBudget: HISTORY_FULL_TOKEN_BUDGET,
    compactedChars: COMPACTED_TURN_CHARS,
  })
  return packed.map((turn) =>
    turn.compacted
      ? {
          role: turn.role,
          content: `[Earlier ${turn.role === 'assistant' ? 'narrator' : 'player'} turn, compacted: ${turn.content}]`,
        }
      : { role: turn.role, content: turn.content },
  )
}

function shouldTickNpcAgent(
  stance: string,
  inputMode: string,
  state: { presentCharacters: Array<{ is_player: number; agency_level: string }> },
): boolean {
  if (inputMode !== 'in-character' || stance === 'meta' || stance === 'think') return false
  if (stance === 'do' || stance === 'say') return true
  return state.presentCharacters.some(
    (c) => c.is_player !== 1 && (c.agency_level === 'local' || c.agency_level === 'nearby'),
  )
}

function shouldRunArchivistLlm(
  playerText: string,
  narratorText: string,
  hasDeterministicPatch: boolean,
): boolean {
  if (hasRichStorySignal(playerText, narratorText)) return true
  const text = `${playerText}\n${narratorText}`.toLowerCase()
  return (
    !hasDeterministicPatch &&
    /\b(leave|left|arrive|arrives|enter|entered|go to|drive to|walk to)\b/.test(text)
  )
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
