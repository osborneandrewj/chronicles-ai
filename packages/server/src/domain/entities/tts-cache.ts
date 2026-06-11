// Cached TTS audio entity. Pure type declaration (spec §3.3). `audio` is the
// raw synthesized bytes; the cache key is (world, turn, model, voice, hash).

export type CachedTtsAudio = {
  contentType: string
  audio: Buffer
  byteLength: number
}
