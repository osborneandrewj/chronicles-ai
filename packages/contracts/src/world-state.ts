// World-state read DTOs (GET /api/world-state). The server derives every
// render-only field so the client ships NO domain logic (spec §2.4, §3-P6):
//   • badges[]  — was deriveCharacterBadges / deriveSceneBadge (inspector-badges)
//   • grouped player-profile facts — was organizePlayerProfileFacts
//   • parsed [t:N] provenance — was the inline parseStateEntry strip in WorldInspector
// The shapes below mirror those derivations so the inspector renders directly.

// ── Inspector badges ─────────────────────────────────────────────────────────
export type BadgeTone = 'player' | 'danger' | 'muted' | 'here' | 'agency' | 'active'

export type InspectorBadge = {
  label: string
  tone: BadgeTone
}

// ── Grouped player-profile facts ─────────────────────────────────────────────
export type PlayerProfileGroupKey =
  | 'profile'
  | 'gear'
  | 'condition'
  | 'people'
  | 'work'
  | 'business'
  | 'discoveries'
  | 'commitments'
  | 'other'

export type PlayerProfileEntryDTO = {
  line: string
  text: string
}

export type PlayerProfileGroupDTO = {
  key: PlayerProfileGroupKey
  label: string
  entries: PlayerProfileEntryDTO[]
}

// ── Provenance-parsed state entry ([t:N] strip) ──────────────────────────────
// A memorable-fact / observation line with its turn-provenance peeled off so the
// client renders text + an optional turn number with no parsing of its own.
export type StateEntryDTO = {
  text: string
  turnId: number | null
  turnNumber: number | null
}
