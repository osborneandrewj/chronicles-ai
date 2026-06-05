import 'server-only'

import { loadHistory, WorldNotFoundError } from '@/application/use-cases/load-history'
import { getContainer } from '@/composition/container'
import type { Turn } from '@/domain/entities'
import { summarizeTurn, type TurnCost } from '@/lib/turn-cost'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Older-slice fetch for the play-page "Load older" affordance. Thin adapter:
// parse the query, call LoadHistory, render the slice + per-turn cost summaries
// (rendering of the raw metadata is the adapter's job), map WorldNotFound→404.

type ResponseBody = {
  turns: Turn[]
  usage: TurnCost[]
  hasMore: boolean
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const worldId = Number(url.searchParams.get('worldId'))
  if (!Number.isInteger(worldId) || worldId <= 0) {
    return new globalThis.Response('Missing or invalid worldId', { status: 400 })
  }

  const before = Number(url.searchParams.get('before'))
  if (!Number.isInteger(before) || before <= 0) {
    return new globalThis.Response('Missing or invalid before', { status: 400 })
  }

  const rawLimit = Number(url.searchParams.get('limit'))
  const limit = Number.isInteger(rawLimit) ? rawLimit : undefined

  const { worlds, turns } = getContainer()
  let result
  try {
    result = await loadHistory({ worldId, before, limit }, { worlds, turns })
  } catch (err) {
    if (err instanceof WorldNotFoundError) {
      return new globalThis.Response(err.message, { status: 404 })
    }
    throw err
  }

  const usage = result.assistantMetadata.map(({ id, metadata }) =>
    summarizeTurn(id, metadata),
  )
  const body: ResponseBody = {
    turns: result.turns,
    usage,
    hasMore: result.hasMore,
  }
  return globalThis.Response.json(body)
}
