import { allAssistantMetadata } from '@/lib/db'
import { summarizeTurn } from '@/lib/turn-cost'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const turns = allAssistantMetadata().map(({ id, metadata }) => summarizeTurn(id, metadata))
  const total = turns.reduce((sum, t) => sum + t.total, 0)
  return Response.json({ turns, total })
}
