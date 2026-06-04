const XAI_TTS_URL = 'https://api.x.ai/v1/tts'
const XAI_ORIGIN = 'https://api.x.ai'

// xAI's only prosody knob is `speed` (rate multiplier, range 0.7–1.5; default
// 1.0). There is no stability/temperature parameter, so tone drift within a
// single generation isn't tunable via the API — see v0.6.12 milestone Phase 0.
const TTS_SPEED_MIN = 0.7
const TTS_SPEED_MAX = 1.5

export const DEFAULT_VOICE = process.env.TTS_VOICE ?? 'eve'
export const TTS_MODEL_KEY = 'xai-tts-mp3-v1'

export function normalizeVoiceId(voice?: string): string {
  const trimmed = voice?.trim()
  return (trimmed && trimmed.length > 0 ? trimmed : DEFAULT_VOICE).toLowerCase()
}

// Parse the optional TTS_SPEED env var. Returns undefined (→ no `speed` field,
// byte-identical request to pre-v0.6.12) for unset, non-numeric, or
// out-of-range values, so a misconfigured env can never silently distort audio.
export function resolveSpeed(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n < TTS_SPEED_MIN || n > TTS_SPEED_MAX) return undefined
  return n
}

export interface TtsRequestBody {
  text: string
  voice_id: string
  language: string
  output_format: { codec: string }
  speed?: number
}

export function buildTtsRequestBody(
  text: string,
  voiceId: string,
  speed: number | undefined,
): TtsRequestBody {
  const body: TtsRequestBody = {
    text,
    voice_id: voiceId,
    language: 'auto',
    output_format: { codec: 'mp3' },
  }
  if (speed !== undefined) body.speed = speed
  return body
}

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
    body: JSON.stringify(
      buildTtsRequestBody(text, normalizeVoiceId(voice), resolveSpeed(process.env.TTS_SPEED)),
    ),
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

// Non-billable connection warm. xAI exposes no ping/warm endpoint and bills any
// request that reaches synthesis, so we deliberately do NOT hit /v1/tts. A HEAD
// to the API origin pays DNS + TLS + (in serverless) the lambda cold start in
// parallel with narrator generation, taking that tax off the critical path of
// the first real synthesis. Best-effort: any failure is swallowed — a failed
// warm must never affect the subsequent real request.
export async function warmConnection(): Promise<void> {
  try {
    await fetch(XAI_ORIGIN, { method: 'HEAD', signal: AbortSignal.timeout(2000) })
  } catch {
    // Warm is opportunistic; ignore DNS/TLS/timeout/abort failures.
  }
}
