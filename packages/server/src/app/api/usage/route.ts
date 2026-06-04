import { summarizeUsage, WorldNotFoundError } from '@/application/use-cases/summarize-usage'
import { getContainer } from '@/composition/container'
import { summarizeTurn } from '@/lib/turn-cost'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const worldId = Number(url.searchParams.get('worldId'))
  if (!Number.isInteger(worldId) || worldId <= 0) {
    return new Response('Missing or invalid worldId', { status: 400 })
  }

  const { worlds, turns: turnRepo } = getContainer()
  let result
  try {
    result = await summarizeUsage({ worldId }, { worlds, turns: turnRepo })
  } catch (err) {
    if (err instanceof WorldNotFoundError) {
      return new Response(err.message, { status: 404 })
    }
    throw err
  }

  const turns = result.assistantMetadata.map(({ id, metadata }) =>
    summarizeTurn(id, metadata),
  )
  const total = turns.reduce((sum, t) => sum + t.total, 0)
  return Response.json({ turns, total })
}
