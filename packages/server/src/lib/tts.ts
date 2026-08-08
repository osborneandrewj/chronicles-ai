const XAI_TTS_URL = 'https://api.x.ai/v1/tts'
const XAI_ORIGIN = 'https://api.x.ai'

// xAI's only prosody knob is `speed` (rate multiplier, range 0.7–1.5; default
// 1.0). There is no stability/temperature parameter, so tone drift within a
// single generation isn't tunable via the API — see v0.6.12 milestone Phase 0.
const TTS_SPEED_MIN = 0.7
const TTS_SPEED_MAX = 1.5
// Streaming latency optimization: smaller first audio chunk → lower TTFA.
// 0 = best quality (legacy default); 1 = moderate; 2 = aggressive.
const TTS_LATENCY_MIN = 0
const TTS_LATENCY_MAX = 2
// Default to 1 when unset so voice starts sooner without the full quality hit of 2.
const DEFAULT_STREAMING_LATENCY = 1

export const DEFAULT_VOICE = process.env.TTS_VOICE ?? 'eve'
export const TTS_MODEL_KEY = 'xai-tts-mp3-v1'

export function normalizeVoiceId(voice?: string): string {
  const trimmed = voice?.trim()
  return (trimmed && trimmed.length > 0 ? trimmed : DEFAULT_VOICE).toLowerCase()
}

// Parse the optional TTS_SPEED env var. Returns undefined (→ no `speed` field)
// for unset, non-numeric, or out-of-range values, so a misconfigured env can
// never silently distort audio.
export function resolveSpeed(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n < TTS_SPEED_MIN || n > TTS_SPEED_MAX) return undefined
  return n
}

// Parse TTS_OPTIMIZE_STREAMING_LATENCY. Unset → default 1 (faster first audio).
// Explicit "0" disables. Invalid → default 1.
export function resolveStreamingLatency(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_STREAMING_LATENCY
  const n = Number(raw)
  if (!Number.isInteger(n) || n < TTS_LATENCY_MIN || n > TTS_LATENCY_MAX) {
    return DEFAULT_STREAMING_LATENCY
  }
  return n
}

export interface TtsRequestBody {
  text: string
  voice_id: string
  language: string
  output_format: { codec: string }
  speed?: number
  optimize_streaming_latency?: number
}

export function buildTtsRequestBody(
  text: string,
  voiceId: string,
  speed: number | undefined,
  streamingLatency: number = DEFAULT_STREAMING_LATENCY,
): TtsRequestBody {
  const body: TtsRequestBody = {
    text,
    voice_id: voiceId,
    language: 'auto',
    output_format: { codec: 'mp3' },
  }
  if (speed !== undefined) body.speed = speed
  // Always send when non-zero so xAI applies the TTFA tradeoff; omit 0 so a
  // quality-preferring deploy stays byte-identical to the pre-latency body.
  if (streamingLatency > 0) body.optimize_streaming_latency = streamingLatency
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
  // Prefer bidirectional WebSocket TTS: feed text in sentence-sized deltas so
  // xAI can start audio before the full utterance is buffered server-side.
  // Falls back to unary POST on WS failure (older runtimes / network blocks).
  const transport = (process.env.TTS_TRANSPORT ?? 'ws').toLowerCase()
  if (transport !== 'http' && typeof WebSocket !== 'undefined') {
    try {
      return await streamSpeechViaWebSocket(text, voice)
    } catch (err) {
      console.error('[tts] websocket synthesis failed; falling back to POST', err)
    }
  }
  return streamSpeechViaHttp(text, voice)
}

async function streamSpeechViaHttp(text: string, voice?: string): Promise<SpeechResult> {
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
      buildTtsRequestBody(
        text,
        normalizeVoiceId(voice),
        resolveSpeed(process.env.TTS_SPEED),
        resolveStreamingLatency(process.env.TTS_OPTIMIZE_STREAMING_LATENCY),
      ),
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

// Bidirectional streaming TTS. Opens wss://api.x.ai/v1/tts, sends text as
// sentence-sized deltas, and pipes audio.delta frames into a ReadableStream the
// HTTP route can tee to the client + cache. See xAI TTS WebSocket docs.
export async function streamSpeechViaWebSocket(
  text: string,
  voice?: string,
): Promise<SpeechResult> {
  const apiKey = process.env.XAI_API_KEY
  if (!apiKey) {
    throw new TtsError(503, 'XAI_API_KEY is not set')
  }

  const voiceId = normalizeVoiceId(voice)
  const speed = resolveSpeed(process.env.TTS_SPEED)
  const latency = resolveStreamingLatency(process.env.TTS_OPTIMIZE_STREAMING_LATENCY)
  const params = new URLSearchParams({
    language: 'auto',
    voice: voiceId,
    codec: 'mp3',
    sample_rate: '24000',
    bit_rate: '128000',
    optimize_streaming_latency: String(latency),
  })
  if (speed !== undefined) params.set('speed', String(speed))

  const url = `wss://api.x.ai/v1/tts?${params.toString()}`
  const deltas = splitTextDeltas(text)

  const audio = new ReadableStream<Uint8Array>({
    start(controller) {
      let settled = false
      const fail = (err: unknown) => {
        if (settled) return
        settled = true
        try {
          controller.error(err instanceof Error ? err : new Error(String(err)))
        } catch {
          // already closed
        }
        try {
          ws.close()
        } catch {
          // ignore
        }
      }
      const finish = () => {
        if (settled) return
        settled = true
        try {
          controller.close()
        } catch {
          // already closed
        }
        try {
          ws.close()
        } catch {
          // ignore
        }
      }

      const ws = new WebSocket(url, {
        // Node's WebSocket accepts headers via the second-arg options object.
        headers: { Authorization: `Bearer ${apiKey}` },
      } as unknown as string[])

      const openTimer = setTimeout(() => {
        fail(new TtsError(504, 'xAI TTS WebSocket open timeout'))
      }, 8000)

      ws.addEventListener('open', () => {
        clearTimeout(openTimer)
        try {
          for (const delta of deltas) {
            ws.send(JSON.stringify({ type: 'text.delta', delta }))
          }
          ws.send(JSON.stringify({ type: 'text.done' }))
        } catch (err) {
          fail(err)
        }
      })

      ws.addEventListener('message', (event) => {
        try {
          const raw =
            typeof event.data === 'string'
              ? event.data
              : Buffer.from(event.data as ArrayBuffer).toString('utf8')
          const msg = JSON.parse(raw) as {
            type?: string
            delta?: string
            message?: string
          }
          if (msg.type === 'audio.delta' && typeof msg.delta === 'string') {
            controller.enqueue(Buffer.from(msg.delta, 'base64'))
          } else if (msg.type === 'audio.done') {
            finish()
          } else if (msg.type === 'error') {
            fail(new TtsError(502, msg.message ?? 'xAI TTS WebSocket error'))
          }
        } catch (err) {
          fail(err)
        }
      })

      ws.addEventListener('error', () => {
        clearTimeout(openTimer)
        fail(new TtsError(502, 'xAI TTS WebSocket connection error'))
      })

      ws.addEventListener('close', () => {
        clearTimeout(openTimer)
        if (!settled) finish()
      })
    },
  })

  return { audio, contentType: 'audio/mpeg' }
}

// Split utterance into ~sentence-sized text.delta messages so the WS synthesizer
// can start audio on the first sentence without waiting for the whole turn.
function splitTextDeltas(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return ['']
  const parts: string[] = []
  const re = /[.!?]+(?:["')\]”’]*)(?:\s+|$)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(trimmed)) !== null) {
    const end = m.index + m[0].length
    // Keep chunks meaningful (~40+ chars) so we don't spam tiny deltas.
    if (end - last >= 40 || end >= trimmed.length) {
      const piece = trimmed.slice(last, end)
      if (piece.trim()) parts.push(piece)
      last = end
    }
  }
  if (last < trimmed.length) {
    const tail = trimmed.slice(last)
    if (tail.trim()) parts.push(tail)
  }
  return parts.length > 0 ? parts : [trimmed]
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
