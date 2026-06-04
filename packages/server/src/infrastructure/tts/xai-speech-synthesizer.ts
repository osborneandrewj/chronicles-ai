import 'server-only'

import type { SpeechSynthesizer, SynthesizedSpeech } from '@/domain/ports'
import { normalizeVoiceId, streamSpeech, TTS_MODEL_KEY, warmConnection } from '@/lib/tts'

// xAI driven adapter for the SpeechSynthesizer port. A thin wrapper over the
// existing `lib/tts.ts` HTTP client (the provider URL, API key, request body, and
// `TtsError` mapping live there) so the application depends only on the port.

export class XaiSpeechSynthesizer implements SpeechSynthesizer {
  readonly modelKey = TTS_MODEL_KEY

  normalizeVoiceId(voice?: string): string {
    return normalizeVoiceId(voice)
  }

  synthesize(text: string, voiceId: string): Promise<SynthesizedSpeech> {
    return streamSpeech(text, voiceId)
  }

  warm(): Promise<void> {
    return warmConnection()
  }
}
