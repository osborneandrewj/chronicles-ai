// Shared "this turn carries story-shaped content" signal. Used by the archivist
// gate (whether to run the LLM at all) and by the dossier bootstrap (whether to
// force a thread-creation directive when the dossier is still empty).
export function hasRichStorySignal(playerText: string, narratorText: string): boolean {
  const text = `${playerText}\n${narratorText}`.toLowerCase()
  return (
    /\b(named|called|introduced|introduces|appears|arrives|enters|walks in|bartender|clerk|manager|wife|husband|mother|father|daughter|son)\b/.test(
      text,
    ) ||
    /\b(minutes?|hours?|morning|afternoon|evening|night|later|next day|noon|midnight)\b/.test(
      text,
    ) ||
    /\b(dies|dead|wounded|injured|takes|picks up|hands|gives|receives|promises|learns|discovers)\b/.test(
      text,
    ) ||
    /\b(clue|evidence|lead|objective|mission|thread|mystery|fragment|serial|pattern match|matches|matched|scan result|identif(?:y|ies|ied)|decode[sd]?|translat(?:e|es|ed))\b/.test(
      text,
    ) ||
    /\b(call|calls|called|text|texts|email|emails|post|posts|message|messages)\b/.test(text) ||
    // Character classes include BOTH straight (") and curly (U+201C/U+201D)
    // quotes — the narrator emits smart-quoted dialogue, so dropping the curly
    // quotes silently breaks dialogue detection. Keep both pairs intact.
    /["“][^"”]{2,}["”]/.test(`${playerText}\n${narratorText}`)
  )
}

// Pure gate for the focused thread-bootstrap fallback: run it only when a
// bootstrap was warranted (empty dossier + story signal, decided by the caller)
// AND, after the main archivist patch was applied this turn, the world STILL has
// no active thread. The post-apply re-query is what keeps it a true fallback —
// if Haiku (rarely) did emit a thread, the bootstrapper never fires and we never
// spend the extra call.
export function shouldBootstrapThread(args: {
  bootstrapWarranted: boolean
  hasActiveThreadAfterApply: boolean
}): boolean {
  return args.bootstrapWarranted && !args.hasActiveThreadAfterApply
}
