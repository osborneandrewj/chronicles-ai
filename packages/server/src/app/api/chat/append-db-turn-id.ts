import type { UIMessageChunk } from 'ai'

// Appends the persisted `dbTurnId` as a trailing `message-metadata` chunk after
// the narrator stream drains AND `completion` resolves. The narrator adapter
// settles `completion` at its own flush (post-onFinish), so by the time this
// flush runs the id is available and the metadata part is enqueued LAST — the
// flush-after-onFinish ordering the client (Chat.tsx) depends on to key TTS
// caching + per-turn cost. Extracted so the ordering is unit-testable (spec
// §5.3 risk row: an integration test asserts the metadata part arrives last).
export function appendDbTurnId(
  chunks: ReadableStream<UIMessageChunk>,
  completion: Promise<number | undefined>,
): ReadableStream<UIMessageChunk> {
  return chunks.pipeThrough(
    new TransformStream<UIMessageChunk, UIMessageChunk>({
      transform(chunk, controller) {
        controller.enqueue(chunk)
      },
      async flush(controller) {
        const dbTurnId = await completion
        if (dbTurnId != null) {
          controller.enqueue({
            type: 'message-metadata',
            messageMetadata: { dbTurnId },
          })
        }
      },
    }),
  )
}
