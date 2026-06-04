import { getWorldCorrectionsForWorld } from '@/lib/db'
import { getWorld } from '@/lib/worlds'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const worldId = Number(url.searchParams.get('worldId'))
  if (!Number.isInteger(worldId) || worldId <= 0) {
    return new Response('Missing or invalid worldId', { status: 400 })
  }
  const limitParam = url.searchParams.get('limit')
  const limit = limitParam ? Math.max(1, Math.min(200, Number(limitParam))) : 50
  if (!Number.isFinite(limit)) {
    return new Response('Invalid limit', { status: 400 })
  }
  if (!getWorld(worldId)) {
    return new Response(`World ${worldId} not found`, { status: 404 })
  }
  // DESC from the DB; reverse to chronological so the UI can append-render
  // and scroll the newest to the bottom without a client-side sort.
  const rows = getWorldCorrectionsForWorld(worldId, limit).slice().reverse()
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
