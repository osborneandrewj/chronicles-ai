import { createHash } from 'node:crypto'

import type { CachedTtsAudio } from '@/domain/entities'
import type { SpeechSynthesizer, SynthesizedSpeech, TtsCacheRepository } from '@/domain/ports'

// SynthesizeNarration (spec §3.5, §5.1-P5) — orchestrates the narration-audio
// path: derive the voice + cache key, serve a cache hit if one exists, otherwise
// synthesize through the SpeechSynthesizer port and expose a `persist` callback
// the route uses to tee the streamed bytes into the cache. The byte-level tee
// and the HTTP Response/headers are the route adapter's rendering concern; this
// use case owns the cache-or-synthesize decision, the key derivation, and the
// size-capped write.

const MAX_CACHED_AUDIO_BYTES = 8 * 1024 * 1024
const CACHE_TURNS_PER_WORLD = 2

export type CacheRef = { worldId: number; turnId: number }

export type SynthesizeNarrationInput = {
  text: string
  voice?: string
  cacheRef: CacheRef | null
}

export type SynthesizeNarrationDeps = {
  speech: SpeechSynthesizer
  ttsCache: TtsCacheRepository
}

export type SynthesizeNarrationResult =
  | {
      kind: 'hit'
      voiceId: string
      modelKey: string
      cached: CachedTtsAudio
    }
  | {
      kind: 'miss'
      voiceId: string
      modelKey: string
      synthesis: SynthesizedSpeech
      /**
       * Persist the synthesized audio under the cache key for this request.
       * No-op (and never throws) when there is no cacheRef or the audio exceeds
       * the size cap. The route passes a tee'd copy of the streamed bytes.
       */
      persist: (audio: Buffer, contentType: string) => Promise<void>
    }

export async function synthesizeNarration(
  { text, voice, cacheRef }: SynthesizeNarrationInput,
  { speech, ttsCache }: SynthesizeNarrationDeps,
): Promise<SynthesizeNarrationResult> {
  const voiceId = speech.normalizeVoiceId(voice)
  const modelKey = speech.modelKey
  const textHash = hashText(text)

  if (cacheRef) {
    const cached = await ttsCache.get(
      cacheRef.worldId,
      cacheRef.turnId,
      modelKey,
      voiceId,
      textHash,
    )
    if (cached) {
      return { kind: 'hit', voiceId, modelKey, cached }
    }
  }

  const synthesis = await speech.synthesize(text, voiceId)

  const persist = async (audio: Buffer, contentType: string): Promise<void> => {
    if (!cacheRef) return
    if (audio.byteLength > MAX_CACHED_AUDIO_BYTES) return
    await ttsCache.store({
      worldId: cacheRef.worldId,
      turnId: cacheRef.turnId,
      modelKey,
      voiceId,
      textHash,
      contentType,
      audio,
      turnsPerWorld: CACHE_TURNS_PER_WORLD,
    })
  }

  return { kind: 'miss', voiceId, modelKey, synthesis, persist }
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}
