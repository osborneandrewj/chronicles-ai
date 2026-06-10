// Pure domain service (Phase C, C5) — detect a subworld exit (death or
// awakening) from the turn's prose. When the player dies in a simulation, or the
// simulation explicitly ends / they surface from the tank, the session should
// return them to the hub's simulation room (ReturnToHub, C6). This is the trigger.
//
// Deliberately HIGH-PRECISION: a false positive yanks the player out of a live
// simulation, so the patterns require unambiguous death/awakening language rather
// than firing on any mention of sleep or injury. Checks the narrator's prose
// (where the consequence lands) and the player's action (an explicit "I let go").
// No I/O.

export type SubworldExit = { kind: 'death' | 'awakening' }

// Death: the protagonist's life unambiguously ends this turn.
const DEATH_PATTERNS: RegExp[] = [
  /\byou (?:die|are dead|bleed out|are killed)\b/i,
  /\byou draw your last breath\b/i,
  /\byour (?:life|vision) (?:ends|slips away|fades to (?:black|nothing))\b/i,
  /\beverything goes (?:black|dark) (?:as|and) you (?:die|fade|fall|slip away)\b/i,
  /\bthe (?:world|light) goes (?:black|dark) (?:forever|for good|and does not return)\b/i,
]

// Awakening: the simulation explicitly ends or the protagonist surfaces from it.
const AWAKENING_PATTERNS: RegExp[] = [
  /\b(?:you )?(?:wake|awaken|jolt awake|come to|open your eyes|gasp awake) (?:in|inside|into|to|within) (?:a|the) (?:tank|cradle|chair|pod|chamber|vat|capsule|rig)\b/i,
  /\byou surface from the (?:simulation|sim|memory|dream)\b/i,
  /\bthe (?:simulation|sim) (?:ends|collapses|dissolves|shuts down|powers down|releases you)\b/i,
  /\byou are (?:pulled|wrenched|lifted) (?:out of|from) the (?:simulation|sim|tank|cradle|chair)\b/i,
]

function anyMatch(patterns: RegExp[], text: string): boolean {
  return patterns.some((p) => p.test(text))
}

export function detectSubworldExit(
  playerText: string,
  narratorText: string,
): SubworldExit | null {
  const haystack = `${playerText}\n${narratorText}`
  // Awakening takes precedence: a simulated "death" that is really the surfacing
  // moment ("you die — and wake gasping in the tank") is an awakening.
  if (anyMatch(AWAKENING_PATTERNS, haystack)) return { kind: 'awakening' }
  if (anyMatch(DEATH_PATTERNS, haystack)) return { kind: 'death' }
  return null
}
