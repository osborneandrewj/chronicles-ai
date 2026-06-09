import 'server-only'

import { inspectWorld, WorldNotFoundError } from '@/application/use-cases/inspect-world'
import { getContainer } from '@/composition/container'
import { getFullWorldStateVia } from '@/lib/world-state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const worldId = Number(url.searchParams.get('worldId'))
  if (!Number.isInteger(worldId) || worldId <= 0) {
    return new Response('Missing or invalid worldId', { status: 400 })
  }

  // Read the inspector projection through the ACTIVE store's ports (not the
  // legacy SQLite-direct getFullWorldState), so under PERSISTENCE=mongo the
  // inspector reflects the Mongo world. The container satisfies FullWorldStateDeps.
  const container = getContainer()
  try {
    const state = await inspectWorld(
      { worldId },
      { worlds: container.worlds, project: (id) => getFullWorldStateVia(container, id) },
    )
    return Response.json(state)
  } catch (err) {
    if (err instanceof WorldNotFoundError) {
      return new Response(err.message, { status: 404 })
    }
    throw err
  }
}
