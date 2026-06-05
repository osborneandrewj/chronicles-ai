// Back-compat re-export. The canonical, byte-identical-critical implementation
// now lives in @chronicles/contracts/pure/sentence-splitter so the client (live
// narration) and the server (TTS cache write) share ONE chunk-boundary rule —
// diverging boundaries would split the TTS cache and double-spend (spec §2.4).
export {
  splitNewChunks,
  splitNewSentences,
  type SplitOptions,
  type SplitResult,
} from '@chronicles/contracts/pure/sentence-splitter'
