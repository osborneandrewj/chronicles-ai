// Shared "this turn carries story-shaped content" signal. Used by the archivist
// gate (whether to run the LLM at all) and by the dossier bootstrap (whether to
// force a thread-creation directive when the dossier is still empty).
//
// Tuned for precision over recall: a pure ambient time-of-day mention or the
// word "message" in "leave a message" used to fire a full Haiku extract. Those
// false positives burned tokens without changing state. Prefer structured
// signals (named intro, acquisition, injury, quoted dialogue, explicit travel).
export function hasRichStorySignal(playerText: string, narratorText: string): boolean {
  const combined = `${playerText}\n${narratorText}`
  const text = combined.toLowerCase()

  // Named introduction / role arrival.
  if (
    /\b(named|called|introduced|introduces|appears|arrives|enters|walks in)\b/.test(text) ||
    /\b(bartender|clerk|manager|wife|husband|mother|father|daughter|son)\b/.test(text)
  ) {
    return true
  }

  // Time passage that actually advances the clock (not mere time-of-day color).
  if (
    /\b(\d+\s*(minutes?|hours?|days?)|an hour|a minute|half an hour|next day|hours later|minutes later|the next morning)\b/.test(
      text,
    ) ||
    /\b(later that (morning|afternoon|evening|night)|by (dawn|dusk|noon|midnight))\b/.test(text)
  ) {
    return true
  }

  // Injury, death, acquisition, promises, discoveries.
  if (
    /\b(dies|dead|wounded|injured|takes|picks up|hands|gives|receives|promises|learns|discovers)\b/.test(
      text,
    )
  ) {
    return true
  }

  // Story structure / investigation.
  if (
    /\b(clue|evidence|lead|objective|mission|thread|mystery|fragment|serial|pattern match|matches|matched|scan result|identif(?:y|ies|ied)|decode[sd]?|translat(?:e|es|ed))\b/.test(
      text,
    )
  ) {
    return true
  }

  // Communications as story events (not the bare noun "message" alone).
  if (
    /\b(calls?|called|texts?|emails?|posts?)\b/.test(text) ||
    /\b(sends?|sent|leaves?|left)\s+(a\s+)?(message|note|letter)\b/.test(text)
  ) {
    return true
  }

  // Quoted dialogue — straight and curly quotes. Real speech almost always
  // carries name/relationship/state deltas the archivist should catch.
  if (/["“][^"”]{2,}["”]/.test(combined)) {
    return true
  }

  return false
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
