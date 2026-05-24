import { recordLatestAssistantTtsChars } from '@/lib/db'

export const runtime = 'nodejs'

interface RecordBody {
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

  const chars = typeof body.chars === 'number' && Number.isFinite(body.chars) ? body.chars : null
  if (chars === null || chars < 0) {
    return new Response('Missing or invalid chars', { status: 400 })
  }

  recordLatestAssistantTtsChars(worldId, chars)
  return new Response(null, { status: 204 })
}
