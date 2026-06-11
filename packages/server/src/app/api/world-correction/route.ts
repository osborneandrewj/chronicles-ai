import 'server-only'

import { z } from 'zod'

import {
  applyCorrection,
  CorrectionApplyFailed,
  CorrectionExtractFailed,
  WorldNotFoundError,
  type CorrectionPatchResult,
} from '@/application/use-cases/apply-correction'
import { getContainer } from '@/composition/container'
import { applyArchivistPatch, extractCorrectionPatch } from '@/lib/archivist'
import { getNarratorWorldState } from '@/lib/world-state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_TEXT_CHARS = 2000

const BodySchema = z.object({
  worldId: z.number().int().positive(),
  text: z.string().trim().min(1).max(MAX_TEXT_CHARS),
})

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>
  try {
    body = BodySchema.parse(await req.json())
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((i) => i.message).join('; ')
        : 'Invalid request body'
    return new Response(message, { status: 400 })
  }

  const { worlds, turns, corrections } = getContainer()
  let result
  try {
    result = await applyCorrection(
      { worldId: body.worldId, text: body.text },
      {
        worlds,
        turns,
        corrections,
        readPriorState: getNarratorWorldState,
        // The extractor returns a richer type; adapt it to the use case's
        // narrow CorrectionPatchResult shape at this boundary.
        extractPatch: (prior, playerText, recent) =>
          extractCorrectionPatch(
            prior as Parameters<typeof extractCorrectionPatch>[0],
            playerText,
            recent,
          ) as Promise<CorrectionPatchResult>,
        applyPatch: (worldId, turnId, patch) =>
          applyArchivistPatch(
            worldId,
            turnId,
            patch as Parameters<typeof applyArchivistPatch>[2],
          ),
      },
    )
  } catch (err) {
    if (err instanceof WorldNotFoundError) {
      return new Response(err.message, { status: 404 })
    }
    if (err instanceof CorrectionExtractFailed) {
      console.error('[world-correction] extract failed', err.cause)
      return new Response(err.message, { status: 502 })
    }
    if (err instanceof CorrectionApplyFailed) {
      console.error('[world-correction] apply failed', err.cause)
      return new Response(err.message, { status: 500 })
    }
    throw err
  }

  return Response.json({
    id: result.row.id,
    reply: result.reply,
    appliedPatch: result.appliedPatch,
    createdAt: result.row.created_at,
  })
}
