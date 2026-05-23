import { anthropic } from '@ai-sdk/anthropic'
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type ModelMessage,
  type UIMessage,
} from 'ai'

import {
  getLatestStateJson,
  insertTurn,
  recentTurns,
  updateTurnMetadata,
  updateTurnState,
} from '@/lib/db'
import { isMetaCommand, runMetaCommand } from '@/lib/meta-commands'
import { NARRATOR_BASE } from '@/lib/prompt'
import { EXTRACTOR_MODEL, extractState, formatStateBlock, parseState } from '@/lib/state'

const NARRATOR_MODEL = 'claude-sonnet-4-6'
const EPHEMERAL_CACHE = { anthropic: { cacheControl: { type: 'ephemeral' as const } } }

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request) {
  const { messages } = (await req.json()) as { messages: UIMessage[] }

  const latest = messages[messages.length - 1]
  const playerText = latest?.role === 'user' ? extractText(latest) : ''
  if (!playerText) {
    return new Response('Empty player action', { status: 400 })
  }

  if (isMetaCommand(playerText)) {
    return streamMetaResponse(runMetaCommand(playerText))
  }

  insertTurn('user', playerText)

  const state = parseState(getLatestStateJson())
  const stateBlock = formatStateBlock(state)

  // Cacheable prefix = system + all prior turns (excluding the new player action).
  // The dynamic state block and the new action ride in an uncached trailing message.
  const allRecent = recentTurns(21)
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
    content: `${stateBlock}\n\nPLAYER ACTION:\n${playerText}`,
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
      const narratorTurn = insertTurn('assistant', trimmed)
      const narratorMeta = { model: NARRATOR_MODEL, usage: narratorUsage }

      void extractState(state, [
        { role: 'user', content: playerText },
        { role: 'assistant', content: trimmed },
      ])
        .then(({ state: next, usage: extractorUsage }) => {
          updateTurnState(narratorTurn.id, JSON.stringify(next))
          updateTurnMetadata(narratorTurn.id, {
            narrator: narratorMeta,
            extractor: { model: EXTRACTOR_MODEL, usage: extractorUsage },
          })
        })
        .catch((err) => {
          updateTurnMetadata(narratorTurn.id, {
            narrator: narratorMeta,
            extractor: { model: EXTRACTOR_MODEL, error: String(err) },
          })
          console.error('[state extraction failed]', err)
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
