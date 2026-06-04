import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import { appendDbTurnId } from '@/app/api/chat/append-db-turn-id'

// Integration test (spec §5.3 risk row): the `dbTurnId` trailing-metadata part
// must arrive LAST in the narrator stream. The client (Chat.tsx) reads it to key
// TTS caching + per-turn cost; if it arrived mid-stream or never, both break
// silently. This pins the flush-after-onFinish ordering the carve must preserve.

async function collect(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const out: UIMessageChunk[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out.push(value)
  }
  return out
}

function textStream(parts: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  return new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(p)
      controller.close()
    },
  })
}

const narratorChunks: UIMessageChunk[] = [
  { type: 'text-start', id: 'n1' },
  { type: 'text-delta', id: 'n1', delta: 'The door ' },
  { type: 'text-delta', id: 'n1', delta: 'creaks open.' },
  { type: 'text-end', id: 'n1' },
]

describe('chat stream — dbTurnId metadata ordering', () => {
  it('appends the dbTurnId message-metadata part LAST, after all narrator chunks', async () => {
    const merged = appendDbTurnId(textStream(narratorChunks), Promise.resolve(42))
    const chunks = await collect(merged)

    const last = chunks[chunks.length - 1]
    expect(last.type).toBe('message-metadata')
    expect((last as { messageMetadata: { dbTurnId: number } }).messageMetadata.dbTurnId).toBe(42)

    // It is the only metadata part, and every narrator chunk precedes it.
    const metaIndexes = chunks.flatMap((c, i) => (c.type === 'message-metadata' ? [i] : []))
    expect(metaIndexes).toEqual([chunks.length - 1])
    expect(chunks.slice(0, -1)).toEqual(narratorChunks)
  })

  it('emits NO metadata part when the turn streamed empty (completion resolves undefined)', async () => {
    const merged = appendDbTurnId(textStream(narratorChunks), Promise.resolve(undefined))
    const chunks = await collect(merged)
    expect(chunks.some((c) => c.type === 'message-metadata')).toBe(false)
    expect(chunks).toEqual(narratorChunks)
  })

  it('waits for a slow completion before flushing (metadata still arrives last)', async () => {
    const completion = new Promise<number>((resolve) => setTimeout(() => resolve(7), 10))
    const merged = appendDbTurnId(textStream(narratorChunks), completion)
    const chunks = await collect(merged)
    const last = chunks[chunks.length - 1]
    expect(last.type).toBe('message-metadata')
    expect((last as { messageMetadata: { dbTurnId: number } }).messageMetadata.dbTurnId).toBe(7)
  })
})
