import { anthropic } from '@ai-sdk/anthropic'
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type ModelMessage,
  type UIMessage,
} from 'ai'

import { ARCHIVIST_MODEL, applyArchivistPatch, extractPatch } from '@/lib/archivist'
import { CLASSIFIER_MODEL, classifyAction } from '@/lib/classifier'
import { dailyTokenLimit, isOverDailyLimit, todaysTokens } from '@/lib/cost-cap'
import {
  getActiveSceneForWorld,
  insertTurn,
  latestUserContent,
  recentTurns,
  updateTurnMetadata,
} from '@/lib/db'
import { isMetaCommand, runMetaCommand } from '@/lib/meta-commands'
import { formatPremiseBlock, NARRATOR_BASE } from '@/lib/prompt'
import { formatStateBlock, getNarratorWorldState } from '@/lib/world-state'
import { getWorld } from '@/lib/worlds'

const NARRATOR_MODEL = 'claude-sonnet-4-6'
const EPHEMERAL_CACHE = { anthropic: { cacheControl: { type: 'ephemeral' as const } } }

export const runtime = 'nodejs'
export const maxDuration = 60

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

  const { messages } = (await req.json()) as { messages: UIMessage[] }

  const latest = messages[messages.length - 1]
  const playerText = latest?.role === 'user' ? extractText(latest) : ''
  if (!playerText) {
    return new Response('Empty player action', { status: 400 })
  }

  if (isMetaCommand(playerText)) {
    return streamMetaResponse(runMetaCommand(playerText, worldId))
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

  // Idempotent on retry: if the trailing player text matches the latest persisted user
  // turn for this world, skip re-insertion. Lets the client re-fire the same request
  // after a stream error without duplicating turns.
  if (latestUserContent(worldId) !== playerText) {
    insertTurn(worldId, 'user', playerText, activeSceneId)
  }

  const classification = await classifyAction(playerText)
  const { stance, input_mode } = classification

  const priorState = getNarratorWorldState(worldId)
  const stateBlock = formatStateBlock(priorState)
  const premiseBlock = formatPremiseBlock(world.premise)

  // Cacheable prefix = system + all prior turns (excluding the new player action).
  // The dynamic premise + state block and the new action ride in an uncached
  // trailing message. NARRATOR_BASE is world-agnostic so the system-prompt cache
  // entry survives across worlds; per-world premise lives in the trailing slot.
  const allRecent = recentTurns(worldId, 21)
  const priorHistory = allRecent.slice(0, -1)
  const historyMessages: ModelMessage[] = priorHistory.map((t) => ({
    role: t.role,
    content: t.content,
  }))

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
        model: CLASSIFIER_MODEL,
        classification: { stance, input_mode },
        usage: classification.usage,
        error: classification.error,
      }

      void extractPatch(world.premise, priorState, [
        { role: 'user', content: playerText },
        { role: 'assistant', content: trimmed },
      ])
        .then(({ patch, usage: archivistUsage }) => {
          applyArchivistPatch(worldId, narratorTurn.id, patch)
          updateTurnMetadata(narratorTurn.id, {
            narrator: narratorMeta,
            archivist: { model: ARCHIVIST_MODEL, usage: archivistUsage, patch },
            classifier: classifierMeta,
          })
        })
        .catch((err) => {
          updateTurnMetadata(narratorTurn.id, {
            narrator: narratorMeta,
            archivist: { model: ARCHIVIST_MODEL, error: String(err) },
            classifier: classifierMeta,
          })
          console.error('[archivist patch failed]', err)
        })
    },
  })

  return result.toUIMessageStreamResponse()
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

function extractText(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
    .trim()
}
