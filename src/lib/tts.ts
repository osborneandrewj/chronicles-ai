const XAI_TTS_URL = 'https://api.x.ai/v1/tts'

export const DEFAULT_VOICE = process.env.TTS_VOICE ?? 'eve'

export interface SpeechResult {
  audio: ReadableStream<Uint8Array>
  contentType: string
}

export class TtsError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'TtsError'
    this.status = status
  }
}

export async function streamSpeech(text: string, voice?: string): Promise<SpeechResult> {
  const apiKey = process.env.XAI_API_KEY
  if (!apiKey) {
    throw new TtsError(503, 'XAI_API_KEY is not set')
  }

  const res = await fetch(XAI_TTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      voice_id: (voice ?? DEFAULT_VOICE).toLowerCase(),
      language: 'auto',
      output_format: { codec: 'mp3' },
    }),
  })

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => res.statusText)
    throw new TtsError(res.status, `xAI TTS ${res.status}: ${detail.slice(0, 200)}`)
  }

  return {
    audio: res.body,
    contentType: res.headers.get('content-type') ?? 'audio/mpeg',
  }
}
