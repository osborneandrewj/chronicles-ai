import { createHash } from 'node:crypto'

import { getCachedTtsAudio, storeCachedTtsAudio } from '@/lib/db'
import { normalizeVoiceId, streamSpeech, TTS_MODEL_KEY, TtsError } from '@/lib/tts'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_TEXT_CHARS = 12000
const MAX_CACHED_AUDIO_BYTES = 8 * 1024 * 1024
const CACHE_TURNS_PER_WORLD = 2

interface TtsRequestBody {
  text?: unknown
  voice?: unknown
  worldId?: unknown
  turnId?: unknown
}

export async function POST(req: Request) {
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
  const voiceId = normalizeVoiceId(voice)
  const cacheRef = parseCacheRef(body)
  const textHash = hashText(text)

  if (cacheRef) {
    const cached = getCachedTtsAudio(
      cacheRef.worldId,
      cacheRef.turnId,
      TTS_MODEL_KEY,
      voiceId,
      textHash,
    )
    if (cached) {
      return new Response(new Uint8Array(cached.audio), {
        status: 200,
        headers: {
          'Content-Type': cached.contentType,
          'Content-Length': String(cached.byteLength),
          'Cache-Control': 'no-store',
          'X-TTS-Cache': 'HIT',
          'X-TTS-Voice': voiceId,
          'X-TTS-Model': TTS_MODEL_KEY,
        },
      })
    }
  }

  try {
    const { audio, contentType } = await streamSpeech(text, voiceId)
    const responseAudio = cacheRef ? teeAudioForCache(audio, {
      worldId: cacheRef.worldId,
      turnId: cacheRef.turnId,
      modelKey: TTS_MODEL_KEY,
      voiceId,
      textHash,
      contentType,
    }) : audio

    return new Response(responseAudio, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        'X-TTS-Cache': 'MISS',
        'X-TTS-Voice': voiceId,
        'X-TTS-Model': TTS_MODEL_KEY,
      },
    })
  } catch (err) {
    if (err instanceof TtsError) {
      console.error('[tts] xAI error', err.status, err.message)
      return new Response(err.message, { status: err.status })
    }
    console.error('[tts] unexpected error', err)
    return new Response('TTS failed', { status: 500 })
  }
}

function parseCacheRef(body: TtsRequestBody): { worldId: number; turnId: number } | null {
  const worldId = typeof body.worldId === 'number' ? body.worldId : NaN
  const turnId = typeof body.turnId === 'number' ? body.turnId : NaN
  if (!Number.isInteger(worldId) || worldId <= 0) return null
  if (!Number.isInteger(turnId) || turnId <= 0) return null
  return { worldId, turnId }
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function teeAudioForCache(
  audio: ReadableStream<Uint8Array>,
  cache: {
    worldId: number
    turnId: number
    modelKey: string
    voiceId: string
    textHash: string
    contentType: string
  },
): ReadableStream<Uint8Array> {
  const [clientAudio, cacheAudio] = audio.tee()
  void cacheAudioStream(cacheAudio, cache)
  return clientAudio
}

async function cacheAudioStream(
  audio: ReadableStream<Uint8Array>,
  cache: {
    worldId: number
    turnId: number
    modelKey: string
    voiceId: string
    textHash: string
    contentType: string
  },
): Promise<void> {
  try {
    const arrayBuffer = await new Response(audio).arrayBuffer()
    if (arrayBuffer.byteLength > MAX_CACHED_AUDIO_BYTES) return
    storeCachedTtsAudio({
      ...cache,
      audio: Buffer.from(arrayBuffer),
      turnsPerWorld: CACHE_TURNS_PER_WORLD,
    })
  } catch (err) {
    console.error('[tts] audio cache write failed', err)
  }
}
