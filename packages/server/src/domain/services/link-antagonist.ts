// Pure antagonist linkage decisions. Persistence is the caller's job.
// MetaStoryBible.antagonist is prose — match/create rules are bounded + idempotent.

import type { Character, MetaStoryBible } from '@/domain/entities'
import { parseClearanceLevel } from '@/domain/services/clearance'

export type AntagonistLinkDecision =
  | { action: 'already_linked'; characterId: number }
  | { action: 'match_existing'; characterId: number; name: string }
  | { action: 'create'; name: string; description: string }
  | { action: 'none' }

/** Extract a likely proper name from bible antagonist prose (first Capitalized run). */
export function extractAntagonistNameHint(prose: string): string | null {
  const cleaned = prose.replace(/\s+/g, ' ').trim()
  if (!cleaned) return null
  // Prefer "Name Surname" patterns early in the string.
  const m = cleaned.match(
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/,
  )
  if (m?.[1] && m[1].length >= 2 && m[1].length <= 40) return m[1]
  // Fallback: first 40 chars as display label if short enough
  if (cleaned.length <= 40 && !/[,.;:]/.test(cleaned)) return cleaned
  return null
}

export function linkAntagonistCharacter(args: {
  bible: MetaStoryBible | null
  hubCharacters: Character[]
  /** Previously stored antagonist character id (idempotent). */
  existingAntagonistId: number | null
}): AntagonistLinkDecision {
  if (args.existingAntagonistId != null) {
    const stillThere = args.hubCharacters.some((c) => c.id === args.existingAntagonistId)
    if (stillThere) {
      return { action: 'already_linked', characterId: args.existingAntagonistId }
    }
  }

  // Prefer a character already stamped antagonist clearance.
  const stamped = args.hubCharacters.find(
    (c) =>
      c.is_player !== 1 &&
      parseClearanceLevel((c as Character & { clearance_level?: string }).clearance_level) ===
        'antagonist',
  )
  if (stamped) {
    return { action: 'match_existing', characterId: stamped.id, name: stamped.name }
  }

  const prose = args.bible?.antagonist?.trim() ?? ''
  if (!prose) return { action: 'none' }

  const hint = extractAntagonistNameHint(prose)
  if (hint) {
    const exact = args.hubCharacters.find(
      (c) => c.is_player !== 1 && c.name.toLowerCase() === hint.toLowerCase(),
    )
    if (exact) {
      return { action: 'match_existing', characterId: exact.id, name: exact.name }
    }
    // Partial: name appears in character name or description
    const partial = args.hubCharacters.find((c) => {
      if (c.is_player === 1) return false
      const hay = `${c.name} ${c.description ?? ''}`.toLowerCase()
      return hay.includes(hint.toLowerCase())
    })
    if (partial) {
      return { action: 'match_existing', characterId: partial.id, name: partial.name }
    }
  }

  // Senior role-compatible: distant/local agency with agenda language
  const senior = [...args.hubCharacters]
    .filter((c) => c.is_player !== 1 && c.status === 'active')
    .sort((a, b) => {
      const rank = (c: Character) =>
        c.agency_level === 'distant' ? 3 : c.agency_level === 'local' ? 2 : 1
      return rank(b) - rank(a) || a.id - b.id
    })[0]
  if (senior) {
    return { action: 'match_existing', characterId: senior.id, name: senior.name }
  }

  // Create once
  const name = hint ?? 'Program Director'
  return {
    action: 'create',
    name,
    description: clip(`Hub antagonist / program face. ${prose}`, 400),
  }
}

function clip(text: string, max: number): string {
  const c = text.replace(/\s+/g, ' ').trim()
  if (c.length <= max) return c
  return `${c.slice(0, max - 1).trimEnd()}…`
}
