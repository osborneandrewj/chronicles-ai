import 'server-only'

import { inspectWorld, WorldNotFoundError } from '@/application/use-cases/inspect-world'
import { getContainer } from '@/composition/container'
import { getFullWorldState } from '@/lib/world-state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const worldId = Number(url.searchParams.get('worldId'))
  if (!Number.isInteger(worldId) || worldId <= 0) {
    return new Response('Missing or invalid worldId', { status: 400 })
  }

  const { worlds } = getContainer()
  try {
    const state = await inspectWorld(
      { worldId },
      { worlds, project: getFullWorldState },
    )
    return Response.json(state)
  } catch (err) {
    if (err instanceof WorldNotFoundError) {
      return new Response(err.message, { status: 404 })
    }
    throw err
  }
}
