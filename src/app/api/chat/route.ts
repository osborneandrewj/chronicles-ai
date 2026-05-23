import { anthropic } from '@ai-sdk/anthropic'
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from 'ai'

import {
  getLatestStateJson,
  insertTurn,
  recentTurns,
  updateTurnState,
} from '@/lib/db'
import { isMetaCommand, runMetaCommand } from '@/lib/meta-commands'
import { buildNarratorSystem } from '@/lib/prompt'
import { extractState, formatStateBlock, parseState } from '@/lib/state'

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
  const system = buildNarratorSystem(formatStateBlock(state))

  const history = recentTurns(20).map((t) => ({ role: t.role, content: t.content }))
  const modelMessages = convertToModelMessages(
    history.map((t, i) => ({
      id: String(i),
      role: t.role,
      parts: [{ type: 'text' as const, text: t.content }],
    })),
  )

  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system,
    messages: modelMessages,
    onFinish: ({ text }) => {
      const trimmed = text.trim()
      if (trimmed.length === 0) return
      const narratorTurn = insertTurn('assistant', trimmed)
      void extractState(state, [
        { role: 'user', content: playerText },
        { role: 'assistant', content: trimmed },
      ])
        .then((next) => updateTurnState(narratorTurn.id, JSON.stringify(next)))
        .catch((err) => {
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
