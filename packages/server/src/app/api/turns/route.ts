import { getContainer } from '@/composition/container'
import type { AssistantTurnMetadata, Turn } from '@/lib/db'
import { summarizeTurn, type TurnCost } from '@/lib/turn-cost'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Older-slice fetch for the play-page "Load older" affordance. Returns up to
// `limit` turns with id < before, oldest-to-newest, alongside the matching
// assistant-turn cost summaries and a hasMore flag so the client knows when to
// hide the button.
const DEFAULT_LIMIT = 60
const MAX_LIMIT = 200

type Response = {
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
  const { worlds, turns: turnRepo } = getContainer()
  if (!(await worlds.getWorld(worldId))) {
    return new globalThis.Response(`World ${worldId} not found`, { status: 404 })
  }

  const before = Number(url.searchParams.get('before'))
  if (!Number.isInteger(before) || before <= 0) {
    return new globalThis.Response('Missing or invalid before', { status: 400 })
  }

  const rawLimit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT)
  const limit =
    Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT

  const turns = await turnRepo.turnsBefore(worldId, before, limit)
  if (turns.length === 0) {
    const body: Response = { turns: [], usage: [], hasMore: false }
    return globalThis.Response.json(body)
  }

  // Metadata scoped to the just-loaded slice. min = the slice's first turn id,
  // maxExclusive = the original `before` so we don't double-fetch anything the
  // client already has.
  const meta: AssistantTurnMetadata[] = await turnRepo.assistantMetadataInRange(
    worldId,
    turns[0].id,
    before,
  )
  const usage = meta.map(({ id, metadata }) => summarizeTurn(id, metadata))

  const body: Response = {
    turns,
    usage,
    hasMore: await turnRepo.hasTurnBefore(worldId, turns[0].id),
  }
  return globalThis.Response.json(body)
}
