import { allAssistantMetadata } from '@/lib/db'
import { summarizeTurn } from '@/lib/turn-cost'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const worldId = Number(url.searchParams.get('worldId'))
  if (!Number.isInteger(worldId) || worldId <= 0) {
    return new Response('Missing or invalid worldId', { status: 400 })
  }
  const turns = allAssistantMetadata(worldId).map(({ id, metadata }) => summarizeTurn(id, metadata))
  const total = turns.reduce((sum, t) => sum + t.total, 0)
  return Response.json({ turns, total })
}
