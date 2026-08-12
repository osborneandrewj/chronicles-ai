// Shared "this turn carries story-shaped content" signal. Used by the archivist
// gate (whether to run the LLM at all) and by the dossier bootstrap (whether to
// force a thread-creation directive when the dossier is still empty).
//
// Tuned for precision over recall: a pure ambient time-of-day mention or the
// word "message" in "leave a message" used to fire a full Haiku extract. Those
// false positives burned tokens without changing state. Prefer structured
// signals (named intro, acquisition, injury, quoted dialogue, explicit travel).
//
// Resolution language is a *separate* helper so bootstrap / general extract stay
// precision-biased while outcome turns with active dossier rows still reach the
// archivist (plot-lifecycle-continuity).

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

/**
 * Outcome / closure language — used only when the world already has active
 * dossier rows, so ambient uses of "clear" / "reveal" don't burn Haiku tokens
 * on empty-dossier worlds.
 */
export function hasResolutionStorySignal(playerText: string, narratorText: string): boolean {
  const text = `${playerText}\n${narratorText}`.toLowerCase()

  // Completion / resolution verbs (prefer multi-word / story-shaped where easy).
  if (
    /\b(complet(?:e|ed|es|ing)|finish(?:ed|es|ing)?|resolv(?:e|ed|es|ing)|settl(?:e|ed|es|ing)|deliver(?:ed|s|ing)?|secur(?:e|ed|es|ing)|recover(?:ed|s|ing)?|defeat(?:ed|s|ing)?|escap(?:e|ed|es|ing)|confess(?:ed|es|ing)?|prov(?:e|ed|es|ing)|fail(?:ed|s|ing)?)\b/.test(
      text,
    )
  ) {
    return true
  }

  // Pay / clear in mission-shaped phrases (avoid bare "pay attention", "clear the table").
  if (
    /\b(pay(?:s|ed|ing)?\s+(the\s+)?(debt|ransom|fee|bribe|toll)|debt\s+paid|paid\s+in\s+full)\b/.test(
      text,
    ) ||
    /\b(clear(?:s|ed|ing)?\s+(your\s+|his\s+|her\s+|their\s+|the\s+)?(name|debt|charges?|record))\b/.test(
      text,
    )
  ) {
    return true
  }

  // Reveal / prove in evidence-shaped phrases.
  if (
    /\b(reveal(?:s|ed|ing)?\s+(the\s+)?(truth|secret|name|identity|plan|evidence))\b/.test(text) ||
    /\b(proof|proven|case\s+closed|job\s+(is\s+)?done|objective\s+complete|mission\s+complete|mission\s+accomplished)\b/.test(
      text,
    )
  ) {
    return true
  }

  // Missed deadline / failure clock.
  if (/\b(miss(?:ed|es|ing)?\s+(the\s+)?deadline|deadline\s+(passed|missed)|too\s+late)\b/.test(text)) {
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

/**
 * Whether the archivist LLM should run this turn.
 * - Rich story signal → always.
 * - Active dossier + resolution language → run (so closures get marked).
 * - Travel language without deterministic patch → run (existing fallback).
 */
export function shouldRunArchivistLlm(
  playerText: string,
  narratorText: string,
  hasDeterministicPatch: boolean,
  activeDossierCount = 0,
): boolean {
  if (hasRichStorySignal(playerText, narratorText)) return true
  if (activeDossierCount > 0 && hasResolutionStorySignal(playerText, narratorText)) {
    return true
  }
  const text = `${playerText}\n${narratorText}`.toLowerCase()
  return (
    !hasDeterministicPatch &&
    /\b(leave|left|arrive|arrives|enter|entered|go to|drive to|walk to)\b/.test(text)
  )
}
