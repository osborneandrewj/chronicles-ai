// Pure domain service (Phase D, D1) — the reality-bending / lucidity track. The
// player escalates from noticing an impossibility to acting on it. Lucidity is
// EARNED by discovery, not arbitrary leveling: it ticks up on a turn that
// questions, breaks, or bends the simulation's rules — not on ordinary action.
// No I/O; the caller persists the result via sessions.setLucidity.

// Cap aligned with the Meta-Story Bible's escalation ladder (6 acts, 0..5).
export const MAX_LUCIDITY = 5

// Strong signals that this turn is a discovery / rule-violation beat. Kept
// high-precision so lucidity doesn't creep on incidental wording.
const DISCOVERY_PATTERNS: RegExp[] = [
  /\bnone of this is real\b/i,
  /\bthis (?:isn't|is not) real\b/i,
  /\bthe (?:world|rules?|laws?) (?:bends?|break(?:s|ing)?|ripples?|glitch(?:es)?|flickers?|unravels?)\b/i,
  /\byou (?:bend|rewrite|break|reshape|warp) (?:the|its|these) (?:rules?|laws?|physics|world|fabric)\b/i,
  /\b(?:time|the air|the room) (?:slows|stutters|freezes|skips|loops)\b/i,
  /\byou (?:reach|push) (?:through|past) the (?:edge|seam|surface|membrane|boundary)\b/i,
  /\ba glitch\b/i,
  /\bthe simulation\b/i,
  /\byou will it (?:to|into)\b/i,
]

// Returns the lucidity delta for this turn (0 or 1), respecting the cap. Only
// applies once `current` is known so a maxed-out track stays put.
export function lucidityDelta(
  playerText: string,
  narratorText: string,
  current: number,
): number {
  if (current >= MAX_LUCIDITY) return 0
  const haystack = `${playerText}\n${narratorText}`
  return DISCOVERY_PATTERNS.some((p) => p.test(haystack)) ? 1 : 0
}

// The narrator-facing stage of the reality-bending track at a given lucidity:
// early the world feels fixed, mid it cracks, late the player gains affordances.
export function lucidityStage(lucidity: number): 'fixed' | 'cracks' | 'affordances' {
  if (lucidity <= 1) return 'fixed'
  if (lucidity <= 3) return 'cracks'
  return 'affordances'
}
