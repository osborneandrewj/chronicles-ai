// SpeechSynthesizerPort (spec §3.4, §3.5) — driven port over the TTS provider.
// The application asks for a normalized voice id, a streamed synthesis, or a
// non-billable connection warm; the concrete xAI HTTP details (URL, API key,
// request body, error mapping) live in the infrastructure adapter. Async by
// mandate (spec §5.3).

export interface SynthesizedSpeech {
  audio: ReadableStream<Uint8Array>
  contentType: string
}

export interface SpeechSynthesizer {
  /** The model key the cache is partitioned by (e.g. `xai-tts-mp3-v1`). */
  readonly modelKey: string

  /** Normalize a (possibly absent) requested voice to a canonical voice id. */
  normalizeVoiceId(voice?: string): string

  /** Synthesize `text` in `voiceId`. Rejects with a provider error on failure. */
  synthesize(text: string, voiceId: string): Promise<SynthesizedSpeech>

  /** Best-effort, non-billable connection warm. Never throws. */
  warm(): Promise<void>
}
