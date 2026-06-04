import { addTtsChars } from '@/lib/db'

export const runtime = 'nodejs'

interface RecordBody {
  turnId?: unknown
  chars?: unknown
}

export async function POST(req: Request) {
  const url = new URL(req.url)
  const worldId = Number(url.searchParams.get('worldId'))
  if (!Number.isInteger(worldId) || worldId <= 0) {
    return new Response('Missing or invalid worldId', { status: 400 })
  }

  let body: RecordBody
  try {
    body = (await req.json()) as RecordBody
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const turnId =
    typeof body.turnId === 'number' && Number.isInteger(body.turnId) && body.turnId > 0
      ? body.turnId
      : null
  if (turnId === null) {
    return new Response('Missing or invalid turnId', { status: 400 })
  }
  const chars = typeof body.chars === 'number' && Number.isFinite(body.chars) ? body.chars : null
  if (chars === null || chars < 0) {
    return new Response('Missing or invalid chars', { status: 400 })
  }

  addTtsChars(worldId, turnId, chars)
  return new Response(null, { status: 204 })
}
