import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessageChunk,
} from 'ai'
import { z } from 'zod'

import {
  advanceTurn,
  BudgetExceededError,
  EmptyPlayerActionError,
  WorldNotFoundError,
  type CannedResponse,
} from '@/application/use-cases/advance-turn'
import { appendDbTurnId } from '@/app/api/chat/append-db-turn-id'
import { getContainer } from '@/composition/container'
import { narrateTurn } from '@/infrastructure/narrator/narrate-turn'
import { dailyTokenLimit, isOverDailyLimit, todaysTokens } from '@/lib/cost-cap'
import { getActiveSceneForWorld } from '@/lib/db'
import { isMetaCommand, runMetaCommand } from '@/lib/meta-commands'

// Thin inbound adapter (spec §3.5, §5.1-P5). Parses messages[]→playerText,
// calls the AdvanceTurn use case, and renders the returned value: a canned
// stream (meta/replay) or the narrator `NarrationStream {chunks, completion}`.
// The `dbTurnId` metadata part is appended after `completion` resolves — the
// flush-after-onFinish ordering the client depends on. Domain errors map to
// HTTP status ONLY here, at the edge. No pipeline logic lives in this file.

export const runtime = 'nodejs'
export const maxDuration = 60

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

export async function POST(req: Request) {
  const url = new URL(req.url)
  const worldId = Number(url.searchParams.get('worldId'))
  if (!Number.isInteger(worldId) || worldId <= 0) {
    return new Response('Missing or invalid worldId', { status: 400 })
  }

  const { worlds, turns, backgroundTasks } = getContainer()

  // World existence is checked before body parsing (preserved ordering: an
  // unknown world 404s regardless of body shape). AdvanceTurn re-checks too.
  if (!(await worlds.getWorld(worldId))) {
    return new Response(`World ${worldId} not found`, { status: 404 })
  }

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

  let result
  try {
    result = await advanceTurn(
      {
        worldId,
        playerText,
        incomingMessages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          text: extractText(m),
        })),
      },
      {
        worlds,
        turns,
        backgroundTasks,
        isOverDailyLimit,
        todaysTokens,
        dailyTokenLimit,
        isMetaCommand,
        runMetaCommand,
        activeSceneId: (id) => getActiveSceneForWorld(id)?.id ?? null,
        buildNarration: narrateTurn,
      },
    )
  } catch (err) {
    if (err instanceof WorldNotFoundError) {
      return new Response(`World ${worldId} not found`, { status: 404 })
    }
    if (err instanceof EmptyPlayerActionError) {
      return new Response('Empty player action', { status: 400 })
    }
    if (err instanceof BudgetExceededError) {
      return Response.json(
        {
          error: 'daily_token_limit_reached',
          message: err.message,
          used: err.used,
          limit: err.limit,
        },
        { status: 429 },
      )
    }
    throw err
  }

  if (result.kind === 'canned') {
    return streamCanned(result.response)
  }

  // Pipe the narrator chunks verbatim, then append the dbTurnId metadata part
  // once `completion` resolves — which the narrator adapter settles only after
  // the source stream drains (post-onFinish), so the metadata always lands last.
  const { chunks, completion } = result.stream
  const dbTurnIdStream = appendDbTurnId(chunks as ReadableStream<UIMessageChunk>, completion)

  return createUIMessageStreamResponse({ stream: dbTurnIdStream })
}

function streamCanned(response: CannedResponse): Response {
  const text = response.text
  const id = response.kind === 'replay' ? String(response.turnId) : `meta-${Date.now()}`
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: 'text-start', id })
      writer.write({ type: 'text-delta', id, delta: text })
      writer.write({ type: 'text-end', id })
    },
  })
  return createUIMessageStreamResponse({ stream })
}

function extractText(msg: ChatMessage): string {
  return msg.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim()
}
