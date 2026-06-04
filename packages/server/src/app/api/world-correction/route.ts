import { z } from 'zod'

import { applyArchivistPatch, extractCorrectionPatch } from '@/lib/archivist'
import { getContainer } from '@/composition/container'
import { getNarratorWorldState } from '@/lib/world-state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_TEXT_CHARS = 2000
const RECENT_TURNS_FOR_CONTEXT = 4

const BodySchema = z.object({
  worldId: z.number().int().positive(),
  text: z.string().trim().min(1).max(MAX_TEXT_CHARS),
})

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>
  try {
    body = BodySchema.parse(await req.json())
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues.map((i) => i.message).join('; ') : 'Invalid request body'
    return new Response(message, { status: 400 })
  }

  const { worlds, turns, corrections } = getContainer()
  const world = await worlds.getWorld(body.worldId)
  if (!world) return new Response(`World ${body.worldId} not found`, { status: 404 })

  const prior = getNarratorWorldState(body.worldId)
  const recent = (await turns.recentTurns(body.worldId, RECENT_TURNS_FOR_CONTEXT))
    // recentTurns returns DESC by id; the prompt wants chronological order.
    .slice()
    .reverse()
    .map((t) => ({ role: t.role, content: t.content }))

  let result: Awaited<ReturnType<typeof extractCorrectionPatch>>
  try {
    result = await extractCorrectionPatch(prior, body.text, recent)
  } catch (err) {
    console.error('[world-correction] extract failed', err)
    return new Response('Correction extraction failed', { status: 502 })
  }

  const latest = await turns.latestTurn(body.worldId)
  // turn_id pins the correction to the narrative moment it was made at — so
  // the scrollback can render "made after turn N" later, and so [t:N][edit]
  // tagging on any memorable_facts the model writes lands on a real id. May
  // be null for a fresh world with no turns yet.
  const turnId = latest?.id ?? null

  try {
    applyArchivistPatch(body.worldId, turnId ?? 0, result.patch)
  } catch (err) {
    console.error('[world-correction] apply failed', err)
    return new Response('Correction apply failed', { status: 500 })
  }

  const row = await corrections.insert(
    body.worldId,
    turnId,
    body.text,
    result.reply,
    result.patch,
  )

  // Stash the cost on the latest turn's metadata so the existing usage
  // dashboard accumulates correction calls under the archivist bucket.
  if (latest) {
    const existing = (await turns.latestMetadata(body.worldId))?.metadata ?? {}
    const prior = (existing as { archivist?: { usage?: { inputTokens?: number; outputTokens?: number } } })
      .archivist?.usage ?? { inputTokens: 0, outputTokens: 0 }
    await turns.mergeMetadata(latest.id, 'archivist', {
      usage: {
        inputTokens: (prior.inputTokens ?? 0) + (result.usage.inputTokens ?? 0),
        outputTokens: (prior.outputTokens ?? 0) + (result.usage.outputTokens ?? 0),
      },
    })
  }

  return Response.json({
    id: row.id,
    reply: result.reply,
    appliedPatch: result.patch,
    createdAt: row.created_at,
  })
}
