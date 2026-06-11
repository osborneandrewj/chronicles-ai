// Pure domain service (item/inventory tracking) — resolves a tracked object's
// possession state from a story-resource patch, enforcing the one-state-at-a-time
// possession model and the patch's tri-state semantics. No I/O: the use case
// resolves names → ids (async, via repositories) and hands the resolved ids here;
// this decides the final column writes (set / clear / leave-unchanged) and the
// mutual exclusion between "held by a character" and "resting at a place".
//
// Possession model — a row is in exactly one state:
//   carried   → held_by_character_id set, location_place_id NULL
//   placed    → held_by_character_id NULL, location_place_id set
//   lost      → both NULL (status='missing')
//
// Tri-state name fields (held_by_name / location_name) mirror the goal/attitude
// convention elsewhere in the patch:
//   undefined → leave the column unchanged
//   null      → clear the column
//   string    → set the column (when the name resolves to a real id)
//
// A non-empty name that fails to resolve is treated as "unchanged" rather than a
// clear — a holder/location typo must not silently drop a real possessor.
import type { NarratorWorldState } from '@/lib/world-state'

type FieldIntent = 'set' | 'clear' | 'unchanged'

// The four columns the DossierWriter.updateResource path needs to apply
// possession: a value to set (when not clearing/unchanged) plus an explicit
// clear flag per column. On the insert path only the *_place_id / *_character_id
// values are read (clear and unchanged both mean "no value").
export type ResolvedPossession = {
  held_by_character_id: number | null
  clear_held_by: boolean
  location_place_id: number | null
  clear_location: boolean
}

export type PossessionInput = {
  // Tri-state names, verbatim from the patch.
  heldByName?: string | null
  locationName?: string | null
  // Resolved ids — only meaningful when the matching name is a non-empty string.
  // null means "name was a clear/unchanged, or a set-name that did not resolve".
  heldById: number | null
  locationId: number | null
}

function intentFor(name: string | null | undefined, resolvedId: number | null): FieldIntent {
  if (name === undefined) return 'unchanged'
  if (name === null || name.trim() === '') return 'clear'
  // A set-name that did not resolve to an id is left unchanged (no clobber).
  return resolvedId !== null ? 'set' : 'unchanged'
}

// Decide the held_by / location column writes for one story-resource patch,
// enforcing mutual exclusion: an object on a person has no resting place, and an
// object resting somewhere is held by no one. A `set` on either side forces the
// other to `clear`; held-by wins if a (contradictory) patch sets both.
export function resolvePossession(input: PossessionInput): ResolvedPossession {
  let held = intentFor(input.heldByName, input.heldById)
  let location = intentFor(input.locationName, input.locationId)

  if (held === 'set') {
    location = 'clear'
  } else if (location === 'set') {
    held = 'clear'
  }

  return {
    held_by_character_id: held === 'set' ? input.heldById : null,
    clear_held_by: held === 'clear',
    location_place_id: location === 'set' ? input.locationId : null,
    clear_location: location === 'clear',
  }
}

// Does the protagonist currently carry a tracked object matching `name`? Used by
// the deterministic drop/give extractor so a player can only move (drop, stash,
// hand over) an object the ledger says they actually hold — no phantom moves.
// Matches on normalized name equality or whole-phrase containment, so "the key"
// resolves to a held "brass key".
export function playerPossesses(prior: NarratorWorldState, name: string): boolean {
  const player =
    prior.presentCharacters.find((c) => c.is_player === 1) ??
    prior.knownCharacters.find((c) => c.is_player === 1)
  if (!player) return false
  const target = normalizeName(name)
  if (!target) return false
  return prior.dossier.resources.some(
    (r) => r.held_by_character_id === player.id && namesMatch(normalizeName(r.name), target),
  )
}

// Local copies of the generic string helpers (kept self-contained to avoid a
// value-import cycle with patch-sanitizer, which depends on this module).
function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(?:the|a|an|my|his|her|their|its)\s+/, '')
}

function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  return ` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `)
}
