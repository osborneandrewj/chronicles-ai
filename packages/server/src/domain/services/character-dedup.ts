import type { Character } from '@/domain/entities'
import { isDescriptorName, nameKey } from '@/lib/character-identity'

export type DuplicatePair = {
  aId: number
  bId: number
  aName: string
  bName: string
  reason: string
}

// Ignore short/boilerplate lines so "has a daughter" doesn't false-match.
const FACT_MIN_LEN = 25

// Placeholder labels that denote the protagonist, not a real NPC. A non-player
// row carrying one of these is a stray pseudo-player to fold into the real
// is_player=1 row (the duplicate-protagonist bug).
const PSEUDO_PLAYER_NAMES = new Set(['player', 'you', 'protagonist', 'the player'])

function distinctiveLines(text: string | null): Set<string> {
  if (!text) return new Set()
  return new Set(
    text
      .split('\n')
      .map((l) => l.replace(/\s*\[t:\d+\]\s*$/, '').trim().toLowerCase())
      .filter((l) => l.length >= FACT_MIN_LEN),
  )
}

// Recall-favoring duplicate detector. Review-only: a few false positives are
// acceptable (a human confirms before any merge); a miss is not. Pure — takes
// rows, returns candidate pairs.
export function findLikelyDuplicateCharacters(chars: Character[]): DuplicatePair[] {
  const active = chars.filter((c) => c.is_player === 0 && c.status !== 'dead')
  const pairs: DuplicatePair[] = []
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]
      const b = active[j]
      let reason: string | null = null

      // Rule 1: descriptor + named, same place. Ordered cheapest-check-first;
      // two descriptor-only names at the same place are intentionally NOT flagged
      // here — Rules 2/3 remain as fallbacks for those.
      if (
        a.current_place_id != null &&
        a.current_place_id === b.current_place_id &&
        isDescriptorName(a.name) !== isDescriptorName(b.name)
      ) {
        reason = 'descriptor + named at same place'
      }

      // Rule 2: near-identical normalized name
      if (!reason) {
        const ka = nameKey(a.name)
        if (ka && ka === nameKey(b.name)) reason = 'near-identical name'
      }

      // Rule 3: shared distinctive memorable fact / observation
      if (!reason) {
        const aLines = new Set([
          ...distinctiveLines(a.memorable_facts),
          ...distinctiveLines(a.observations),
        ])
        const bLines = new Set([
          ...distinctiveLines(b.memorable_facts),
          ...distinctiveLines(b.observations),
        ])
        for (const l of aLines) {
          if (bLines.has(l)) {
            reason = 'shared memorable fact'
            break
          }
        }
      }

      if (reason) pairs.push({ aId: a.id, bId: b.id, aName: a.name, bName: b.name, reason })
    }
  }

  // Single-player invariant (A9). The pairwise loop above skips is_player rows,
  // so the duplicate-protagonist split was never flagged. Detect it directly:
  // more than one is_player=1 row, or a stray "Player"/"You" NPC that should be
  // folded into the protagonist.
  const players = chars.filter((c) => c.is_player === 1 && c.status !== 'dead')
  const canonicalPlayer = players[0] ?? null
  for (let i = 1; i < players.length; i++) {
    pairs.push({
      aId: players[0].id,
      bId: players[i].id,
      aName: players[0].name,
      bName: players[i].name,
      reason: 'multiple player rows',
    })
  }
  if (canonicalPlayer) {
    for (const c of chars) {
      if (c.is_player === 1 || c.status === 'dead') continue
      if (PSEUDO_PLAYER_NAMES.has(c.name.trim().toLowerCase())) {
        pairs.push({
          aId: canonicalPlayer.id,
          bId: c.id,
          aName: canonicalPlayer.name,
          bName: c.name,
          reason: 'stray pseudo-player row',
        })
      }
    }
  }

  return pairs
}
