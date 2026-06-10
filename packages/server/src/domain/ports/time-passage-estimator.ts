// TimePassageEstimator (starship P6) — the one LLM seam for the prose-driven
// ship-clock. Given the just-written narration prose (and the world time it
// opened at), it estimates how much IN-WORLD time the beat covered, in minutes.
// The narrate-turn pipeline advances the ship-clock counter by that estimate, so
// narrative time flows from the STORY rather than a fixed per-turn tick. The port
// is a pure domain interface; the Haiku adapter owns the LLM call + Zod
// validation, and a deterministic stub backs tests + the offline scripts.

export type TimePassageEstimate = {
  // Estimated in-world minutes the narration covered (>= 0).
  elapsedMinutes: number
}

export type TimePassageEstimatorInput = {
  // The just-written narrator prose for this turn (untrusted; read-only).
  narration: string
  // The world time the turn opened at, for context (a narrative render like
  // 'Day 3 — early morning'); null on the very first turn.
  priorWorldTime: string | null
}

export interface TimePassageEstimator {
  estimate(input: TimePassageEstimatorInput): Promise<TimePassageEstimate>
}
