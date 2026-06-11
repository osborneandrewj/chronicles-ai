// Pure domain service (P4, spec §3.3, §5.1-P4 item 3): the deciding RULES for
// character/place name resolution and merge-field computation. No I/O — every
// function takes loaded rows and returns a value (a match verdict, a chosen
// field, a computed merged-field object). The SQL-issuing wrappers
// (resolveCharacter / mergeCharacters / runAliasMerges / mergePlaces) remain in
// the archivist for now and call these helpers; the full "return a MergePlan,
// issue no SQL" use-case carve is staged separately (the merge path and scene
// path must not move in one step — Open-Q#5).
//
// Extracted verbatim from src/lib/archivist.ts (no behavior change); the
// existing archivist.test.ts merge characterization tests cover the outcomes.
import type { CharacterRow, PlaceRow } from '@/lib/archivist'
import { canonicalPlaceKey, containsAsPhrase, normalize } from '@/domain/services/patch-sanitizer'

export const CHARACTER_TITLE_WORDS = new Set([
  'captain',
  'capt',
  'chief',
  'doctor',
  'dr',
  'father',
  'general',
  'inquisitor',
  'lieutenant',
  'lt',
  'major',
  'miss',
  'mister',
  'mr',
  'mrs',
  'ms',
  'professor',
  'prof',
  'sergeant',
  'sgt',
])

const DESCRIPTIVE_CHARACTER_WORDS = new Set([
  'figure',
  'man',
  'shadow',
  'stranger',
  'woman',
])

const PLACE_DETAIL_WORDS = new Set([
  'apartment',
  'bedroom',
  'breakroom',
  'building',
  'bullpen',
  'campus',
  'fifth',
  'first',
  'floor',
  'food',
  'fourth',
  'front',
  'garage',
  'home',
  'house',
  'inside',
  'kitchen',
  'lot',
  'office',
  'room',
  'second',
  'shop',
  'sixth',
  'street',
  'third',
  'truck',
])

const GENERIC_ROOM_KEYS = new Set([
  'attic',
  'basement',
  'bathroom',
  'bedroom',
  'garage',
  'hallway',
  'kitchen',
  'living room',
  'office',
])

export function placesMatch(
  requestedName: string,
  existingName: string,
  currentPlace: PlaceRow | undefined,
): boolean {
  const requested = canonicalPlaceKey(requestedName)
  const existing = canonicalPlaceKey(existingName)
  if (!requested || !existing) return false
  if (requested === existing) return true
  if (containsAsPhrase(requested, existing) || containsAsPhrase(existing, requested)) {
    const requestedTokens = requested.split(' ')
    const existingTokens = existing.split(' ')
    const extraTokens =
      requestedTokens.length > existingTokens.length
        ? requestedTokens.filter((token) => !existingTokens.includes(token))
        : existingTokens.filter((token) => !requestedTokens.includes(token))
    return extraTokens.every((token) => PLACE_DETAIL_WORDS.has(token))
  }
  if (GENERIC_ROOM_KEYS.has(requested) && currentPlace?.id) {
    return currentPlace.name === existingName && isResidentialPlace(currentPlace)
  }
  return false
}

export function isResidentialPlace(place: PlaceRow): boolean {
  return /\b(?:apartment|bedroom|home|house|kitchen|residence)\b/i.test(
    `${place.name} ${place.description ?? ''} ${place.kind ?? ''}`,
  )
}

// For scalar single-valued fields, the older "target-first" rule discarded the
// merge source's value any time the target had one — even a stale one. That
// silently lost fresh state (active_goal, current_focus, current_attitude,
// current_place_id) whenever the older row happened to be the merge target.
// Now: pick whichever input value comes from the more recently updated row;
// non-null still beats null, ties go to target. Row-level updated_at is a
// coarse proxy for per-field freshness but matches user intuition (the row the
// system has been writing to is the live one).
export function freshest<T>(
  target: CharacterRow,
  source: CharacterRow,
  pick: (row: CharacterRow) => T | null,
): T | null {
  const t = pick(target)
  const s = pick(source)
  if (t === null || t === undefined) return s ?? null
  if (s === null || s === undefined) return t
  return source.updated_at > target.updated_at ? s : t
}

export function charactersMatch(requestedName: string, existingName: string): boolean {
  const requested = canonicalCharacterKey(requestedName)
  const existing = canonicalCharacterKey(existingName)
  if (!requested || !existing) return false
  if (requested === existing) return true
  if (isDescriptiveCharacterName(requestedName) || isDescriptiveCharacterName(existingName)) return false

  const requestedTokens = characterTokens(requestedName)
  const existingTokens = characterTokens(existingName)
  if (requestedTokens.length === 0 || existingTokens.length === 0) return false

  const shorter = requestedTokens.length <= existingTokens.length ? requestedTokens : existingTokens
  const longer = requestedTokens.length <= existingTokens.length ? existingTokens : requestedTokens
  if (shorter.length > 1) return shorter.every((token) => longer.includes(token))

  const token = shorter[0]
  if (token.length < 4) return false
  return longer.includes(token)
}

export function isAmbiguousCharacterMatch(requestedName: string, matches: CharacterRow[]): boolean {
  const requestedTokens = characterTokens(requestedName)
  if (requestedTokens.length !== 1) return false
  const token = requestedTokens[0]
  return matches.filter((row) => characterTokens(row.name).includes(token)).length > 1
}

export function canonicalCharacterKey(value: string): string {
  return characterTokens(value).join(' ')
}

export function characterTokens(value: string): string[] {
  return normalize(value)
    .split(' ')
    .filter((token) => token.length > 0 && !CHARACTER_TITLE_WORDS.has(token))
}

function isDescriptiveCharacterName(value: string): boolean {
  const tokens = characterTokens(value)
  return (
    normalize(value).startsWith('the ') ||
    tokens.some((token) => DESCRIPTIVE_CHARACTER_WORDS.has(token))
  )
}

export function chooseLonger(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return b.length > a.length ? b : a
}

// Aliases are stored as a newline-separated list. This helper drops any line
// whose canonical key matches the canonical name itself (a row's canonical
// name is never simultaneously one of its aliases) plus exact duplicate
// lines, and returns null when the resulting list is empty.
export function filterAliasesAgainstName(raw: string | null, name: string): string | null {
  if (!raw) return null
  const nameKey = canonicalCharacterKey(name)
  const seen = new Set<string>()
  const kept: string[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const key = canonicalCharacterKey(trimmed)
    if (!key || key === nameKey) continue
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(trimmed)
  }
  return kept.length > 0 ? kept.join('\n') : null
}

// Alias-aware lookup. Returns the existing row whose canonical name matches
// the requested name, OR whose aliases list contains a line whose canonical
// key matches. Used by resolveCharacter() so the archivist can record "the
// man at the gyro van" as an alias on "the man in the canvas vest" and
// subsequent prose referencing either descriptor lands on the same row.
export function findCharacterByNameOrAlias(
  rows: CharacterRow[],
  requestedName: string,
): CharacterRow | null {
  const requestedKey = canonicalCharacterKey(requestedName)
  if (!requestedKey) return null
  for (const row of rows) {
    if (canonicalCharacterKey(row.name) === requestedKey) return row
    if (!row.aliases) continue
    for (const line of row.aliases.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (canonicalCharacterKey(trimmed) === requestedKey) return row
    }
  }
  return null
}

export function mergeLineBlocks(a: string | null, b: string | null): string | null {
  const lines = [...(a?.split('\n') ?? []), ...(b?.split('\n') ?? [])]
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) return null
  return [...new Set(lines)].join('\n')
}

export function strongestStatus(
  a: CharacterRow['status'],
  b: CharacterRow['status'],
): CharacterRow['status'] {
  const rank = { inactive: 0, active: 1, dead: 2 }
  return rank[b] > rank[a] ? b : a
}

export function strongestAgencyLevel(a: string, b: string): string {
  const rank: Record<string, number> = { npc: 0, dormant: 1, distant: 2, nearby: 3, local: 4 }
  return (rank[b] ?? 0) > (rank[a] ?? 0) ? b : a
}

export function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.max(a, b)
}
