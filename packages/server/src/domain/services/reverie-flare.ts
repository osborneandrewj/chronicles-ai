import type { FlareCandidate } from '@/domain/entities'

export const MAX_REVERIES_PER_NPC = 3

// v0.6.x: how many of this world's player turns must pass between an NPC
// minting one reverie and the next. Deterministic rate throttle; the agent
// prompt's "rarely" is only a nudge. Tunable.
export const REVERIE_COOLDOWN_TURNS = 15

// Pure decision: may this NPC mint a new reverie this tick? The first one (no
// reveries yet) is always free; afterwards a full cooldown must have elapsed.
export function canMintReverie(
  state: { hasAny: boolean; playerTurnsSinceLast: number },
  cooldown = REVERIE_COOLDOWN_TURNS,
): boolean {
  return !state.hasAny || state.playerTurnsSinceLast >= cooldown
}

export function normalizeReverieTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function normalizeReverieText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function clampIntensity(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.5
  return Math.min(1, Math.max(0, value))
}

// Pure. Per NPC, the single highest-scoring reverie with >=1 tag overlap is a
// candidate (score = overlapCount * intensity). Present NPCs are guaranteed a
// slot; the remainder fill by score until perTurnCap. Deterministic tie-breaks
// keep output stable across runs.
export function computeReverieFlares(
  candidates: FlareCandidate[],
  sceneTags: string[],
  opts: { perTurnCap?: number; presentCharacterIds?: number[] },
): number[] {
  const perTurnCap = opts.perTurnCap ?? 2
  const present = new Set(opts.presentCharacterIds ?? [])
  const sceneSet = new Set(sceneTags.map(normalizeReverieTag))

  type Scored = { id: number; character_id: number; score: number; intensity: number }
  const winnerByChar = new Map<number, Scored>()
  for (const c of candidates) {
    const overlap = c.match_tags.reduce(
      (n, t) => (sceneSet.has(normalizeReverieTag(t)) ? n + 1 : n),
      0,
    )
    if (overlap === 0) continue
    const scored: Scored = {
      id: c.id,
      character_id: c.character_id,
      score: overlap * c.intensity,
      intensity: c.intensity,
    }
    const prev = winnerByChar.get(c.character_id)
    if (
      !prev ||
      scored.score > prev.score ||
      (scored.score === prev.score && scored.intensity > prev.intensity) ||
      (scored.score === prev.score && scored.intensity === prev.intensity && scored.id < prev.id)
    ) {
      winnerByChar.set(c.character_id, scored)
    }
  }

  const winners = [...winnerByChar.values()].sort((a, b) => {
    const aPresent = present.has(a.character_id) ? 1 : 0
    const bPresent = present.has(b.character_id) ? 1 : 0
    if (aPresent !== bPresent) return bPresent - aPresent
    if (b.score !== a.score) return b.score - a.score
    return a.id - b.id
  })

  return winners.slice(0, perTurnCap).map((w) => w.id)
}
