import { z } from 'zod'

// ── Chat request (POST /api/chat) ────────────────────────────────────────────
// The route handler validates the incoming body with the SAME schema the client
// types its request against — untrusted input crosses the boundary once.

export const ChatMessagePartSchema = z
  .object({ type: z.string(), text: z.string().optional() })
  .passthrough()

export const ChatMessageSchema = z.object({
  id: z.string().optional(),
  role: z.string(),
  parts: z.array(ChatMessagePartSchema),
})

export const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1),
})

export type ChatMessagePart = z.infer<typeof ChatMessagePartSchema>
export type ChatMessage = z.infer<typeof ChatMessageSchema>
export type ChatRequest = z.infer<typeof ChatRequestSchema>

// ── Stream metadata ──────────────────────────────────────────────────────────
// Attached to the streamed assistant message once the turn is persisted. The id
// type is intentionally store-agnostic at the wire (SQLite int → Mongo seq) but
// surfaced as a number today.

export type MessageMetadata = {
  createdAt?: string
  // The real persisted turn id, attached by /api/chat after the stream finishes.
  // History-loaded turns instead encode the id in the message id.
  dbTurnId?: number
}
