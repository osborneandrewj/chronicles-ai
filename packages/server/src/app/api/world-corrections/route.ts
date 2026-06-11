import 'server-only'

import { listCorrections, WorldNotFoundError } from '@/application/use-cases/list-corrections'
import { getContainer } from '@/composition/container'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const worldId = Number(url.searchParams.get('worldId'))
  if (!Number.isInteger(worldId) || worldId <= 0) {
    return new Response('Missing or invalid worldId', { status: 400 })
  }
  const limitParam = url.searchParams.get('limit')
  if (limitParam !== null && !Number.isFinite(Number(limitParam))) {
    return new Response('Invalid limit', { status: 400 })
  }
  const limit = limitParam !== null ? Number(limitParam) : undefined

  const { worlds, corrections } = getContainer()
  let rows
  try {
    rows = await listCorrections({ worldId, limit }, { worlds, corrections })
  } catch (err) {
    if (err instanceof WorldNotFoundError) {
      return new Response(err.message, { status: 404 })
    }
    throw err
  }

  return Response.json({
    corrections: rows.map((row) => ({
      id: row.id,
      turnId: row.turn_id,
      playerText: row.player_text,
      archivistReply: row.archivist_reply,
      createdAt: row.created_at,
    })),
  })
}
