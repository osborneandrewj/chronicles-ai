import 'server-only'

import { xai } from '@ai-sdk/xai'
import {
  stepCountIs,
  streamText,
  type ModelMessage,
  type UIMessageChunk,
} from 'ai'

import type { NarrationContext, NarratorStream } from '@/application/use-cases/advance-turn'
import { NARRATOR_MODEL } from '@/infrastructure/llm/model-registry'
import {
  ARCHIVIST_MODEL,
  applyArchivistPatch,
  extractDeterministicPatch,
  extractPatch,
} from '@/lib/archivist'
import { findLikelyDuplicateCharacters } from '@/lib/character-dedup'
import { classifyAction } from '@/lib/classifier'
import { reconcileNpcIntentsForTurn, RECONCILER_MODEL } from '@/lib/intent-reconciler'
import {
  getCharactersForWorld,
  insertTurn,
  recentTurns,
  updateTurnMetadata,
} from '@/lib/db'
import { narratorMapTools } from '@/lib/map-tools'
import { formatNarratorTurnGuidance } from '@/lib/narrator-guidance'
import { NPC_AGENT_MODEL, runNpcAgentTick } from '@/lib/npc-agent'
import { recordAppearancesAndAutoPromote } from '@/lib/npc-promotion'
import { buildPlaceOccupancySnapshot, type PlaceOccupancy } from '@/lib/place-population'
import { resolveUnresolvedPlaces } from '@/lib/place-resolver'
import { formatPremiseBlock, NARRATOR_BASE } from '@/lib/prompt'
import { computeReverieFlares, getReveriesForCharacters, stampFlaredReveries } from '@/lib/reveries'
import { hasRichStorySignal } from '@/lib/story-signal'
import {
  collectSceneTags,
  formatSceneDigestForClassifier,
  formatStateBlock,
  getNarratorWorldState,
} from '@/lib/world-state'
import { getWorld } from '@/lib/worlds'

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

const NARRATOR_HISTORY_TURNS = 13
const FULL_HISTORY_TURNS = 6

export async function narrateTurn(ctx: NarrationContext): Promise<NarratorStream> {
  const { worldId, playerText, activeSceneId, playerTurnId, backgroundTasks } = ctx

  const world = getWorld(worldId)
  // AdvanceTurn already gated world existence; this is a defensive re-read for
  // `premise`. If it somehow vanished, surface an empty stream.
  if (!world) {
    return { chunks: emptyStream(), completion: Promise.resolve(undefined) }
  }

  // State is read before the classifier so it can see who's present and where.
  const priorState = getNarratorWorldState(worldId)

  // Update NPC attention tiers before the NPC agent call.
  const promotion = recordAppearancesAndAutoPromote(
    worldId,
    priorState.presentCharacters,
    playerTurnId,
  )

  const classification = await classifyAction(
    playerText,
    formatSceneDigestForClassifier(priorState),
  )

  // Lazy real-world geocoding — best-effort, never blocks the narrator.
  await resolveUnresolvedPlaces(worldId).catch((err) => {
    console.error('[place-resolver pre-narrator]', err)
  })

  // NPC agent failure must NEVER block the narrator — degrade to plan-less.
  const postPromotionState = getNarratorWorldState(worldId)
  const recentForAgents = recentTurns(worldId, 4)
  const { stance, input_mode } = classification
  const shouldRunNpcAgent = shouldTickNpcAgent(stance, input_mode, postPromotionState)
  const npcAgentSettled = shouldRunNpcAgent
    ? await runNpcAgentTick(
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
    turnOccupancy = buildPlaceOccupancySnapshot(worldId, playerTurnId)
  } catch (err) {
    console.error('[place-population]', err)
  }

  // Re-read so the just-persisted occupancy snapshot is visible.
  const narratorState = getNarratorWorldState(worldId)
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
  }))
  const presentNpcIds = narratorState.presentCharacters
    .filter((c) => c.is_player !== 1)
    .map((c) => c.id)
  const flaringReverieIds = computeReverieFlares(flareCandidates, sceneTags, {
    presentCharacterIds: presentNpcIds,
  })
  try {
    stampFlaredReveries(flaringReverieIds, playerTurnId)
  } catch (err) {
    console.error('[reverie-flare]', err)
  }

  const stateBlock = formatStateBlock(narratorState, plans, recentNarratorProse, {
    byCharacter: reveriesByCharacter,
    flaring: new Set(flaringReverieIds),
  })
  const premiseBlock = formatPremiseBlock(world.premise)

  const allRecent = recentTurns(worldId, NARRATOR_HISTORY_TURNS)
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
    content: `${premiseBlock}\n\n${stateBlock}\n\nCLASSIFICATION: stance=${stance}, input_mode=${input_mode}\n\n${turnGuidance}\n\nPLAYER ACTION:\n${playerText}`,
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
      const narratorTurn = insertTurn(worldId, 'assistant', trimmed, activeSceneId)
      narratorTurnId = narratorTurn.id

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
      updateTurnMetadata(narratorTurn.id, upfrontMeta)

      // Reconcile NPC plans against the narrator's prose — best-effort.
      if (plans.length > 0) {
        try {
          const reconciliation = await reconcileNpcIntentsForTurn({
            playerTurnId,
            narratorTurnId: narratorTurn.id,
            narratorText: trimmed,
          })
          updateTurnMetadata(narratorTurn.id, {
            npc_intent_reconciler: {
              model: reconciliation.model,
              usage: reconciliation.usage,
              results: reconciliation.results,
              error: reconciliation.error,
              skipped: reconciliation.skipped,
            },
          })
        } catch (err) {
          updateTurnMetadata(narratorTurn.id, {
            npc_intent_reconciler: { model: RECONCILER_MODEL, error: String(err) },
          })
          console.error('[intent reconciler failed]', err)
        }
      }

      const deterministicPatch = extractDeterministicPatch(priorState, playerText, trimmed)
      const runArchivistLlm = shouldRunArchivistLlm(playerText, trimmed, !!deterministicPatch)

      if (!runArchivistLlm && deterministicPatch) {
        applyArchivistPatch(worldId, narratorTurn.id, deterministicPatch)
        updateTurnMetadata(narratorTurn.id, {
          archivist: { model: 'deterministic-archivist', patch: deterministicPatch },
        })
        runDupDetector(worldId)
        return
      }
      if (!runArchivistLlm) {
        updateTurnMetadata(narratorTurn.id, {
          archivist: { model: ARCHIVIST_MODEL, skipped: true, reason: 'no_state_change_signal' },
        })
        return
      }

      const archivistRecent = recentTurns(worldId, 4).map((t) => ({
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
        .then(({ patch, usage: archivistUsage }) => {
          applyArchivistPatch(worldId, narratorTurn.id, patch)
          updateTurnMetadata(narratorTurn.id, {
            archivist: { model: ARCHIVIST_MODEL, usage: archivistUsage, patch },
          })
          runDupDetector(worldId)
        })
        .catch((err) => {
          updateTurnMetadata(narratorTurn.id, {
            archivist: { model: ARCHIVIST_MODEL, error: String(err) },
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

function runDupDetector(worldId: number): void {
  try {
    for (const d of findLikelyDuplicateCharacters(getCharactersForWorld(worldId))) {
      console.warn(
        `[dup-detector] world ${worldId}: "${d.aName}" (#${d.aId}) ~ "${d.bName}" (#${d.bId}) — ${d.reason}`,
      )
    }
  } catch (err) {
    console.error('[dup-detector]', err)
  }
}

function compactHistory(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): ModelMessage[] {
  const fullStart = Math.max(0, history.length - FULL_HISTORY_TURNS)
  return history.map((turn, idx) => {
    if (idx >= fullStart) {
      return { role: turn.role, content: turn.content }
    }
    return {
      role: turn.role,
      content: `[Earlier ${turn.role === 'assistant' ? 'narrator' : 'player'} turn, compacted: ${limitText(
        turn.content,
        320,
      )}]`,
    }
  })
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
