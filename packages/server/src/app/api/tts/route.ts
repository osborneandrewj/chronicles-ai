import 'server-only'

import {
  synthesizeNarration,
  type CacheRef,
} from '@/application/use-cases/synthesize-narration'
import { getContainer } from '@/composition/container'
import { TtsError } from '@/lib/tts'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_TEXT_CHARS = 12000

interface TtsRequestBody {
  text?: unknown
  voice?: unknown
  worldId?: unknown
  turnId?: unknown
}

export async function POST(req: Request) {
  const { speech, ttsCache } = getContainer()

  // Pre-warm path: fired on player submit to overlap xAI's DNS/TLS/cold-start
  // tax with narrator generation. Non-billable — never reaches synthesis.
  // Returns 204 immediately; the warm runs detached.
  if (new URL(req.url).searchParams.get('warm') === '1') {
    void speech.warm()
    return new Response(null, { status: 204 })
  }

  let body: TtsRequestBody
  try {
    body = (await req.json()) as TtsRequestBody
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) {
    return new Response('Missing text', { status: 400 })
  }
  if (text.length > MAX_TEXT_CHARS) {
    return new Response(`text exceeds ${MAX_TEXT_CHARS} chars`, { status: 413 })
  }

  const voice = typeof body.voice === 'string' && body.voice ? body.voice : undefined
  const cacheRef = parseCacheRef(body)

  let result
  try {
    result = await synthesizeNarration({ text, voice, cacheRef }, { speech, ttsCache })
  } catch (err) {
    if (err instanceof TtsError) {
      console.error('[tts] xAI error', err.status, err.message)
      return new Response(err.message, { status: err.status })
    }
    console.error('[tts] unexpected error', err)
    return new Response('TTS failed', { status: 500 })
  }

  if (result.kind === 'hit') {
    return new Response(new Uint8Array(result.cached.audio), {
      status: 200,
      headers: {
        'Content-Type': result.cached.contentType,
        'Content-Length': String(result.cached.byteLength),
        'Cache-Control': 'no-store',
        'X-TTS-Cache': 'HIT',
        'X-TTS-Voice': result.voiceId,
        'X-TTS-Model': result.modelKey,
      },
    })
  }

  const { audio, contentType } = result.synthesis
  const responseAudio = teeAudioForCache(audio, contentType, result.persist)

  return new Response(responseAudio, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-TTS-Cache': 'MISS',
      'X-TTS-Voice': result.voiceId,
      'X-TTS-Model': result.modelKey,
    },
  })
}

function parseCacheRef(body: TtsRequestBody): CacheRef | null {
  const worldId = typeof body.worldId === 'number' ? body.worldId : NaN
  const turnId = typeof body.turnId === 'number' ? body.turnId : NaN
  if (!Number.isInteger(worldId) || worldId <= 0) return null
  if (!Number.isInteger(turnId) || turnId <= 0) return null
  return { worldId, turnId }
}

// Tee the synthesized stream: one copy streams to the client, the other is
// buffered and handed to the use case's `persist` callback (which owns the
// size cap + cache write). Best-effort: a cache-write failure never affects the
// client response.
function teeAudioForCache(
  audio: ReadableStream<Uint8Array>,
  contentType: string,
  persist: (audio: Buffer, contentType: string) => Promise<void>,
): ReadableStream<Uint8Array> {
  const [clientAudio, cacheAudio] = audio.tee()
  void (async () => {
    try {
      const arrayBuffer = await new Response(cacheAudio).arrayBuffer()
      await persist(Buffer.from(arrayBuffer), contentType)
    } catch (err) {
      console.error('[tts] audio cache write failed', err)
    }
  })()
  return clientAudio
}
