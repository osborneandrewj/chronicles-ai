import { z } from 'zod'

// Archivist correction scrollback (GET /api/world-corrections) and the
// apply-a-correction request/response (POST /api/world-correction).

export type CorrectionDTO = {
  id: number
  turnId: number | null
  playerText: string
  archivistReply: string
  createdAt: string
}

export const ApplyCorrectionRequestSchema = z.object({
  worldId: z.number().int().positive(),
  text: z.string().min(1),
})

export type ApplyCorrectionRequest = z.infer<typeof ApplyCorrectionRequestSchema>

export type ApplyCorrectionResponse = {
  id: number
  reply: string
}
