// Pure antagonist linkage decisions. Persistence is the caller's job.
// MetaStoryBible.antagonist is prose — match/create rules are bounded + idempotent.

import type { Character, MetaStoryBible } from '@/domain/entities'
import { parseClearanceLevel } from '@/domain/services/clearance'

export type AntagonistLinkDecision =
  | { action: 'already_linked'; characterId: number }
  | { action: 'match_existing'; characterId: number; name: string }
  | { action: 'create'; name: string; description: string }
  | { action: 'none' }

/** Role/title tokens that are not personal names in bible antagonist prose. */
const ANTAGONIST_TITLE_TOKEN =
  /^(?:Deputy|Director|Dr|Doctor|Commander|Colonel|Captain|Agent|Professor|Chief|Officer|Lt|Lieutenant)$/i

/**
 * Extract a likely proper name from bible antagonist prose.
 * Strips leading titles so "Deputy Director Lira Voss, who…" → "Lira Voss".
 */
export function extractAntagonistNameHint(prose: string): string | null {
  const cleaned = prose.replace(/\s+/g, ' ').trim()
  if (!cleaned) return null

  // Drop leading title stack, then take up to two Capitalized name tokens.
  const deTitled = cleaned
    .replace(
      /^(?:(?:Deputy|Director|Dr\.?|Doctor|Commander|Colonel|Captain|Agent|Professor|Chief)\s+)+/i,
      '',
    )
    .trim()

  const m = deTitled.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/)
  if (m?.[1] && m[1].length >= 2 && m[1].length <= 40 && !ANTAGONIST_TITLE_TOKEN.test(m[1])) {
    return m[1]
  }

  // Fallback: first non-title "Name Surname" anywhere in the string.
  for (const hit of cleaned.matchAll(/\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/g)) {
    const a = hit[1]!
    const b = hit[2]!
    if (ANTAGONIST_TITLE_TOKEN.test(a) || ANTAGONIST_TITLE_TOKEN.test(b)) continue
    const full = `${a} ${b}`
    if (full.length <= 40) return full
  }

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
    // Partial: full hint appears in character name or description (avoid short
    // single-token false hits like "Hale" inside unrelated words when possible).
    const partial = args.hubCharacters.find((c) => {
      if (c.is_player === 1) return false
      const hay = `${c.name} ${c.description ?? ''}`.toLowerCase()
      return hay.includes(hint.toLowerCase())
    })
    if (partial) {
      return { action: 'match_existing', characterId: partial.id, name: partial.name }
    }
    // Named in the bible but not cast — create them. Do NOT promote a random
    // senior crew member (Meridian would have stamped Dana Noel as Lira Voss).
    return {
      action: 'create',
      name: hint,
      description: clip(`Hub antagonist / program face. ${prose}`, 400),
    }
  }

  // No extractable name: prefer an existing senior face, else generic create.
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

  return {
    action: 'create',
    name: 'Program Director',
    description: clip(`Hub antagonist / program face. ${prose}`, 400),
  }
}

function clip(text: string, max: number): string {
  const c = text.replace(/\s+/g, ' ').trim()
  if (c.length <= max) return c
  return `${c.slice(0, max - 1).trimEnd()}…`
}
