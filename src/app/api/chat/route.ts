import { anthropic } from '@ai-sdk/anthropic'
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type ModelMessage,
} from 'ai'
import { z } from 'zod'

import {
  ARCHIVIST_MODEL,
  applyArchivistPatch,
  extractDeterministicPatch,
  extractPatch,
} from '@/lib/archivist'
import { classifyAction } from '@/lib/classifier'
import { NPC_AGENT_MODEL, runNpcAgentTick } from '@/lib/npc-agent'
import { recordAppearancesAndAutoPromote } from '@/lib/npc-promotion'
import { dailyTokenLimit, isOverDailyLimit, todaysTokens } from '@/lib/cost-cap'
import {
  getActiveSceneForWorld,
  insertTurn,
  latestAssistantAfterLatestUser,
  latestTurn,
  latestUserContent,
  latestUserTurnId,
  recentTurns,
  updateTurnMetadata,
} from '@/lib/db'
import { isMetaCommand, runMetaCommand } from '@/lib/meta-commands'
import { formatPremiseBlock, NARRATOR_BASE } from '@/lib/prompt'
import {
  formatSceneDigestForClassifier,
  formatStateBlock,
  getNarratorWorldState,
} from '@/lib/world-state'
import { getWorld } from '@/lib/worlds'

const NARRATOR_MODEL = 'claude-sonnet-4-6'
const EPHEMERAL_CACHE = { anthropic: { cacheControl: { type: 'ephemeral' as const } } }
const NARRATOR_HISTORY_TURNS = 13
const FULL_HISTORY_TURNS = 6

export const runtime = 'nodejs'
export const maxDuration = 60

// Permissive shape: extractText filters parts down to {type:'text', text:string}
// at runtime and ignores anything else, so the schema just needs to confirm we
// got an array of objects with a string `type`. Reasonable client bodies
// (UIMessage from the AI SDK) satisfy this; garbage trips 400 instead of 500.
const ChatMessagePartSchema = z
  .object({ type: z.string(), text: z.string().optional() })
  .passthrough()
const ChatMessageSchema = z.object({
  id: z.string().optional(),
  role: z.string(),
  parts: z.array(ChatMessagePartSchema),
})
const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1),
})
type ChatMessage = z.infer<typeof ChatMessageSchema>

// Track in-flight archivist patches so SIGTERM can await them before exit.
// Railway sends SIGTERM ~10s before SIGKILL on redeploy; a typical archivist
// call is <3s, so this turns "fire-and-pray" into "best-effort with bounded
// loss" without changing the happy-path latency.
const inFlightArchivists = new Set<Promise<unknown>>()
function trackArchivist(p: Promise<unknown>): void {
  inFlightArchivists.add(p)
  void p.finally(() => inFlightArchivists.delete(p))
}

let sigtermInstalled = false
function ensureShutdownHandler(): void {
  if (sigtermInstalled) return
  sigtermInstalled = true
  process.once('SIGTERM', async () => {
    const n = inFlightArchivists.size
    if (n > 0) {
      console.log(`[chat] SIGTERM: awaiting ${n} in-flight archivist patch(es)`)
      await Promise.allSettled([...inFlightArchivists])
    }
    process.exit(0)
  })
}

export async function POST(req: Request) {
  const url = new URL(req.url)
  const worldId = Number(url.searchParams.get('worldId'))
  if (!Number.isInteger(worldId) || worldId <= 0) {
    return new Response('Missing or invalid worldId', { status: 400 })
  }
  const world = getWorld(worldId)
  if (!world) {
    return new Response(`World ${worldId} not found`, { status: 404 })
  }

  ensureShutdownHandler()

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }
  const parsed = ChatRequestSchema.safeParse(rawBody)
  if (!parsed.success) {
    return new Response('Invalid request body', { status: 400 })
  }
  const { messages } = parsed.data

  const latest = messages[messages.length - 1]
  const playerText = latest?.role === 'user' ? extractText(latest) : ''
  if (!playerText) {
    return new Response('Empty player action', { status: 400 })
  }

  if (isMetaCommand(playerText)) {
    return streamMetaResponse(runMetaCommand(playerText, worldId))
  }

  const persistedLatestUserContent = latestUserContent(worldId)
  const latestPersistedTurn = latestTurn(worldId)
  const persistedAssistant = latestAssistantAfterLatestUser(worldId)
  const latestUserAlreadyCompleted =
    persistedLatestUserContent === playerText &&
    latestPersistedTurn?.role === 'assistant' &&
    persistedAssistant?.id === latestPersistedTurn.id
  const incomingHasPersistedAssistant =
    persistedAssistant !== null && includesAssistantTurn(messages, persistedAssistant)

  // A completed retry should replay the existing assistant turn, not spend
  // another classifier/narrator/archivist cycle. If the incoming history
  // already includes that assistant, the same text is an intentional repeat.
  if (latestUserAlreadyCompleted && persistedAssistant && !incomingHasPersistedAssistant) {
    return streamPersistedAssistantResponse(persistedAssistant)
  }

  // Daily shared cost cap. Gated before any LLM call (classifier or narrator)
  // so an exhausted budget never starts a stream we'd have to error mid-flight.
  if (isOverDailyLimit()) {
    return Response.json(
      {
        error: 'daily_token_limit_reached',
        message: 'The shared daily LLM budget is spent. Try again after UTC midnight.',
        used: todaysTokens(),
        limit: dailyTokenLimit(),
      },
      { status: 429 },
    )
  }

  const activeScene = getActiveSceneForWorld(worldId)
  const activeSceneId = activeScene?.id ?? null

  // If the same user text is already the latest persisted user turn and no
  // assistant exists yet, this is an in-flight retry: don't duplicate the user
  // row. Once an assistant exists in the incoming history, allow an intentional
  // repeated action with identical text.
  const intentionalRepeat =
    latestUserAlreadyCompleted && persistedAssistant !== null && incomingHasPersistedAssistant
  if (persistedLatestUserContent !== playerText || intentionalRepeat) {
    insertTurn(worldId, 'user', playerText, activeSceneId)
  }

  // State is read before the classifier so the classifier can see who's
  // present and where. A bare "Where is X?" with an NPC in the room is
  // overwhelmingly likely to be the protagonist asking aloud (say + in-
  // character); without scene context the classifier had no way to know.
  const priorState = getNarratorWorldState(worldId)

  // Capture the just-inserted player turn id for [t:N] provenance on the
  // NPC agent's activity_append lines. The narrator turn doesn't exist
  // yet — agent runs pre-narrator.
  const playerTurnId = latestUserTurnId(worldId) ?? 0

  // Update NPC attention tiers before the NPC agent call. Present recurring
  // NPCs become local (high tick rate), while offscreen agents cool down
  // through nearby/distant/dormant and eventually back to passive npc.
  const promotion = recordAppearancesAndAutoPromote(
    worldId,
    priorState.presentCharacters,
    playerTurnId,
  )

  const classification = await classifyAction(playerText, formatSceneDigestForClassifier(priorState))

  // NPC agent failure must NEVER block the narrator — if Haiku errors, schema
  // validation fails, or the network blips, we degrade to plan-less narration.
  const postPromotionState = getNarratorWorldState(worldId)
  const recentForAgents = recentTurns(worldId, 4)
  const { stance, input_mode } = classification
  const shouldRunNpcAgent = shouldTickNpcAgent(stance, input_mode, postPromotionState)
  const npcAgentSettled = shouldRunNpcAgent
    ? await runNpcAgentTick(worldId, playerTurnId, world.premise, playerText, recentForAgents).catch(
        (err) => {
          console.error('[npc agent failed pre-narrator]', err)
          return { error: String(err) } as const
        },
      )
    : null
  const npcAgentResult =
    npcAgentSettled && 'plans' in npcAgentSettled ? npcAgentSettled : null
  const npcAgentError =
    npcAgentSettled && 'error' in npcAgentSettled ? npcAgentSettled.error : null
  const plans = npcAgentResult?.plans ?? []

  // Re-read state so the narrator sees any place changes the agent applied.
  const narratorState = npcAgentResult ? getNarratorWorldState(worldId) : postPromotionState
  const stateBlock = formatStateBlock(narratorState, plans)
  const premiseBlock = formatPremiseBlock(world.premise)

  // Cacheable prefix = system + all prior turns (excluding the new player action).
  // The dynamic premise + state block and the new action ride in an uncached
  // trailing message. NARRATOR_BASE is world-agnostic so the system-prompt cache
  // entry survives across worlds; per-world premise lives in the trailing slot.
  const allRecent = recentTurns(worldId, NARRATOR_HISTORY_TURNS)
  const priorHistory = allRecent.slice(0, -1)
  const historyMessages = compactHistory(priorHistory)

  const lastAssistantIdx = historyMessages.findLastIndex((m) => m.role === 'assistant')
  if (lastAssistantIdx >= 0) {
    historyMessages[lastAssistantIdx] = {
      ...historyMessages[lastAssistantIdx],
      providerOptions: EPHEMERAL_CACHE,
    }
  }

  const trailingUser: ModelMessage = {
    role: 'user',
    content: `${premiseBlock}\n\n${stateBlock}\n\nCLASSIFICATION: stance=${stance}, input_mode=${input_mode}\n\nPLAYER ACTION:\n${playerText}`,
  }

  const modelMessages: ModelMessage[] = [
    { role: 'system', content: NARRATOR_BASE, providerOptions: EPHEMERAL_CACHE },
    ...historyMessages,
    trailingUser,
  ]

  const result = streamText({
    model: anthropic(NARRATOR_MODEL),
    messages: modelMessages,
    onFinish: ({ text, usage: narratorUsage }) => {
      const trimmed = text.trim()
      if (trimmed.length === 0) return
      const narratorTurn = insertTurn(worldId, 'assistant', trimmed, activeSceneId)
      const narratorMeta = { model: NARRATOR_MODEL, usage: narratorUsage }
      const classifierMeta = {
        model: classification.model,
        method: classification.method,
        classification: { stance, input_mode },
        usage: classification.usage,
        error: classification.error,
      }

      // Visible cost (narrator + classifier + npc agent + promotion) lands
      // immediately so the cost footer reflects the turn the moment the
      // stream ends. updateTurnMetadata uses json_patch under the hood, so
      // the archivist follow-up below merges rather than clobbering.
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
        console.log(
          `[npc promotion] world=${worldId} promoted=${promotion.promoted.join(', ')}`,
        )
      } else if (Object.values(promotion.tiers).some((names) => names.length > 0)) {
        upfrontMeta.npc_promotion = { promoted: [], tiers: promotion.tiers }
      }
      updateTurnMetadata(narratorTurn.id, upfrontMeta)

      const deterministicPatch = extractDeterministicPatch(priorState, playerText, trimmed)
      const runArchivistLlm = shouldRunArchivistLlm(playerText, trimmed, !!deterministicPatch)

      if (!runArchivistLlm && deterministicPatch) {
        applyArchivistPatch(worldId, narratorTurn.id, deterministicPatch)
        updateTurnMetadata(narratorTurn.id, {
          archivist: {
            model: 'deterministic-archivist',
            patch: deterministicPatch,
          },
        })
        return
      }

      if (!runArchivistLlm) {
        updateTurnMetadata(narratorTurn.id, {
          archivist: {
            model: ARCHIVIST_MODEL,
            skipped: true,
            reason: 'no_state_change_signal',
          },
        })
        return
      }

      const archivistRecent = recentTurns(worldId, 4).map((t) => ({
        role: t.role,
        content: t.content,
      }))
      const archivistPromise = extractPatch(world.premise, priorState, archivistRecent)
        .then(({ patch, usage: archivistUsage }) => {
          applyArchivistPatch(worldId, narratorTurn.id, patch)
          updateTurnMetadata(narratorTurn.id, {
            archivist: { model: ARCHIVIST_MODEL, usage: archivistUsage, patch },
          })
        })
        .catch((err) => {
          updateTurnMetadata(narratorTurn.id, {
            archivist: { model: ARCHIVIST_MODEL, error: String(err) },
          })
          console.error('[archivist patch failed]', err)
        })

      trackArchivist(archivistPromise)
    },
  })

  return result.toUIMessageStreamResponse()
}

function compactHistory(history: Array<{ role: 'user' | 'assistant'; content: string }>): ModelMessage[] {
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
  const text = `${playerText}\n${narratorText}`.toLowerCase()
  const richSignal =
    /\b(named|called|introduced|introduces|appears|arrives|enters|walks in|bartender|clerk|manager|wife|husband|mother|father|daughter|son)\b/.test(
      text,
    ) ||
    /\b(minutes?|hours?|morning|afternoon|evening|night|later|next day|noon|midnight)\b/.test(
      text,
    ) ||
    /\b(dies|dead|wounded|injured|takes|picks up|hands|gives|receives|promises|learns|discovers)\b/.test(
      text,
    ) ||
    /\b(call|calls|called|text|texts|email|emails|post|posts|message|messages)\b/.test(text) ||
    /["“][^"”]{2,}["”]/.test(`${playerText}\n${narratorText}`)

  if (richSignal) return true
  return !hasDeterministicPatch && /\b(leave|left|arrive|arrives|enter|entered|go to|drive to|walk to)\b/.test(text)
}

function streamMetaResponse(text: string): Response {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      const id = `meta-${Date.now()}`
      writer.write({ type: 'text-start', id })
      writer.write({ type: 'text-delta', id, delta: text })
      writer.write({ type: 'text-end', id })
    },
  })
  return createUIMessageStreamResponse({ stream })
}

function streamPersistedAssistantResponse(turn: { id: number; content: string }): Response {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      const id = String(turn.id)
      writer.write({ type: 'text-start', id })
      writer.write({ type: 'text-delta', id, delta: turn.content })
      writer.write({ type: 'text-end', id })
    },
  })
  return createUIMessageStreamResponse({ stream })
}

function includesAssistantTurn(
  messages: ChatMessage[],
  turn: { id: number; content: string },
): boolean {
  return messages.some(
    (msg) =>
      msg.role === 'assistant' &&
      (msg.id === String(turn.id) || extractText(msg).trim() === turn.content.trim()),
  )
}

function limitText(value: string, max: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, max - 1).trimEnd()}...`
}

function extractText(msg: ChatMessage): string {
  return msg.parts
    .filter((p): p is { type: 'text'; text: string } =>
      p.type === 'text' && typeof p.text === 'string',
    )
    .map((p) => p.text)
    .join('')
    .trim()
}
