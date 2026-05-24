import { streamSpeech, TtsError } from '@/lib/tts'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_TEXT_CHARS = 2000

interface TtsRequestBody {
  text?: unknown
  voice?: unknown
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

  try {
    const { audio, contentType } = await streamSpeech(text, voice)
    return new Response(audio, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
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
