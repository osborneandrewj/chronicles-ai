// Pure domain service (P4, spec §5.1-P4): archivist patch sanitization and
// deterministic-move extraction. No I/O — every function takes loaded values
// (a NarratorWorldState snapshot, the recent transcript, the raw patch) and
// returns a derived value. The LLM-adapter (archivist agent) runs these at the
// adapter→domain boundary so untrusted model output is sanitized once before
// the use case applies it.
//
// Extracted verbatim from src/lib/archivist.ts (no behavior change). The Zod
// patch schemas remain with the LLM adapter; only the deciding logic moves.
import type { ArchivistPatch } from '@/lib/archivist'
import type { NarratorWorldState } from '@/lib/world-state'
import { extractObjectAcquisition } from '@/domain/services/object-acquisition'

type CharacterPatch = NonNullable<ArchivistPatch['characters']>[number]

export function extractDeterministicPatch(
  prior: NarratorWorldState,
  playerText: string,
  narratorText: string,
): ArchivistPatch | null {
  const patch: ArchivistPatch = {}

  const destination = extractDestination(playerText)
  if (destination) {
    const destinationKey = normalize(destination)
    const player = prior.presentCharacters.find((c) => c.is_player === 1)
    if (
      destinationKey &&
      destinationKey !== normalize(prior.currentPlace?.name ?? '') &&
      narratorAcceptsDestination(destination, narratorText) &&
      player
    ) {
      patch.places = [{ name: destination }]
      patch.characters = [{ name: player.name, is_player: true, current_place_name: destination }]
      patch.scene = {
        action: 'open',
        title: `At ${destination}`,
        place_name: destination,
      }
    }
  }

  // A4: a player clearly taking/receiving an object is promoted to the tracked-
  // object ledger held_by the protagonist, deterministically — so item memory
  // does not depend on the archivist LLM opting in.
  const object = extractObjectAcquisition(playerText, narratorText)
  if (object) {
    patch.story_resources = [{ name: object, held_by_name: 'protagonist', salient: true }]
  }

  return Object.keys(patch).length > 0 ? patch : null
}

export function sanitizeArchivistPatch(
  prior: NarratorWorldState,
  recent: Array<{ role: 'user' | 'assistant'; content: string }>,
  patch: ArchivistPatch,
): ArchivistPatch {
  const latestNarrator = [...recent].reverse().find((t) => t.role === 'assistant')?.content ?? ''
  const latestPlayer = [...recent].reverse().find((t) => t.role === 'user')?.content ?? ''
  const blockedPlayerPlaces = new Set<string>()
  const currentPlaceName = prior.currentPlace?.name ?? null

  const sanitized: ArchivistPatch = { ...patch }

  if (
    patch.scene?.action === 'open' &&
    isDifferentPlace(patch.scene.place_name, currentPlaceName) &&
    !supportsPhysicalTransition(prior, patch.scene.place_name, latestPlayer, latestNarrator)
  ) {
    blockedPlayerPlaces.add(canonicalPlaceKey(patch.scene.place_name))
    delete sanitized.scene
  }

  if (patch.characters) {
    const playerNames = new Set(
      prior.knownCharacters.filter((c) => c.is_player === 1).map((c) => canonicalCharacterKey(c.name)),
    )
    const characters = patch.characters
      .map((c) => {
        if (!isPlayerPatch(c, playerNames) || c.current_place_name === undefined) return c

        const requestedPlace = c.current_place_name
        const blocked = blockedPlayerPlaces.has(canonicalPlaceKey(requestedPlace))
        const unsupported =
          isDifferentPlace(requestedPlace, currentPlaceName) &&
          !supportsPhysicalTransition(prior, requestedPlace, latestPlayer, latestNarrator)

        if (!blocked && !unsupported) return c

        const rest = { ...c }
        delete rest.current_place_name
        return rest
      })
      .filter(hasMeaningfulCharacterPatch)

    if (characters.length > 0) {
      sanitized.characters = characters
    } else {
      delete sanitized.characters
    }
  }

  return sanitized
}

function extractDestination(text: string): string | null {
  const patterns = [
    /\b(?:i\s+)?(?:go|walk|run|drive|head|travel)\s+(?:back\s+)?to\s+(?:the\s+)?([^.!?\n,;]{3,80})/i,
    /\b(?:i\s+)?(?:return)\s+to\s+(?:the\s+)?([^.!?\n,;]{3,80})/i,
    /\b(?:i\s+)?(?:enter|walk into|go into)\s+(?:the\s+)?([^.!?\n,;]{3,80})/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match?.[1]) continue
    const destination = cleanDestination(match[1])
    if (destination) return destination
  }
  return null
}

function narratorAcceptsDestination(destination: string, narratorText: string): boolean {
  const narrator = normalize(narratorText)
  if (!narrator) return false

  const aliases = destinationMentionAliases(destination)
  const mentionsDestination = aliases.some((alias) => containsAsPhrase(narrator, alias))
  if (!mentionsDestination) return false

  // The narrator has to depict actual relocation, arrival, or parking there.
  // This keeps failed attempts ("the road blocks you") from moving state while
  // still accepting natural prose like "Whitworth buildings rise ahead".
  return hasActualMotion(narrator) || /\b(?:arrive|arrival|park|parking|pull into|pulls into|reach|reaches|come into view|comes into view)\b/.test(narrator)
}

function destinationMentionAliases(destination: string): string[] {
  const normalized = normalize(destination)
  const words = normalized.split(' ').filter(Boolean)
  const generic = new Set([
    'the',
    'a',
    'an',
    'to',
    'at',
    'in',
    'university',
    'college',
    'campus',
    'department',
    'building',
    'buildings',
    'room',
    'office',
    'entrance',
    'main',
  ])
  const distinctive = words.filter((word) => word.length >= 4 && !generic.has(word))
  const aliases = [normalized]

  if (distinctive.length === 1) aliases.push(distinctive[0])
  if (distinctive.length > 1) aliases.push(distinctive.join(' '))

  return [...new Set(aliases.filter((alias) => alias.length > 0))]
}

function cleanDestination(raw: string): string | null {
  const value = raw
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\b(?:and|then|so)\b.*$/i, '')
    .trim()
  if (value.length < 3 || value.length > 80) return null
  if (/^(sleep|bed|work|home)$/i.test(value)) return null
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function isPlayerPatch(c: CharacterPatch, playerNames: Set<string>): boolean {
  return c.is_player === true || playerNames.has(canonicalCharacterKey(c.name))
}

function hasMeaningfulCharacterPatch(c: CharacterPatch): boolean {
  return (
    c.description !== undefined ||
    c.current_place_name !== undefined ||
    c.memorable_facts_append !== undefined ||
    c.status !== undefined ||
    c.active_goal !== undefined ||
    c.current_attitude !== undefined ||
    c.observations_append !== undefined ||
    c.player_notes_append !== undefined ||
    (c.aliases !== undefined && c.aliases.length > 0) ||
    c.reveals_name_of !== undefined
  )
}

function isDifferentPlace(requestedName: string, currentName: string | null): boolean {
  if (!currentName) return true
  return canonicalPlaceKey(requestedName) !== canonicalPlaceKey(currentName)
}

function supportsPhysicalTransition(
  prior: NarratorWorldState,
  requestedName: string,
  latestPlayer: string,
  latestNarrator: string,
): boolean {
  const aliases = placeAliasKeys(prior, requestedName)
  if (aliases.length === 0) return false

  const narrator = normalize(latestNarrator)
  const player = normalize(latestPlayer)
  const hasNarratedDestination = aliases.some((alias) => containsAsPhrase(narrator, alias))
  if (!hasNarratedDestination) return false

  return aliases.some((alias) => {
    const narratorWindow = windowAroundPhrase(narrator, alias, 28)
    if (hasActualMotion(narratorWindow)) return true

    const playerWindow = windowAroundPhrase(player, alias, 18)
    return hasActualMotion(playerWindow) && hasActualMotion(narrator)
  })
}

function placeAliasKeys(prior: NarratorWorldState, requestedName: string): string[] {
  const requested = canonicalPlaceKey(requestedName)
  const known = prior.knownPlaces.find((p) => canonicalPlaceKey(p.name) === requested)
  const source = `${requestedName} ${known?.description ?? ''} ${known?.kind ?? ''}`
  const aliases = [requested]

  if (/\b(?:apartment|bedroom|home|house|kitchen|residence)\b/i.test(source)) {
    aliases.push('home', 'house')
  }

  return [...new Set(aliases.filter((alias) => alias.length > 0))]
}

function windowAroundPhrase(value: string, phrase: string, radiusWords: number): string {
  const words = value.split(' ').filter((word) => word.length > 0)
  const phraseWords = phrase.split(' ').filter((word) => word.length > 0)
  if (words.length === 0 || phraseWords.length === 0) return ''

  const idx = words.findIndex((_, i) =>
    phraseWords.every((word, offset) => words[i + offset] === word),
  )
  if (idx === -1) return ''

  const start = Math.max(0, idx - radiusWords)
  const end = Math.min(words.length, idx + phraseWords.length + radiusWords)
  return words.slice(start, end).join(' ')
}

function hasActualMotion(value: string): boolean {
  if (!value) return false
  if (/\b(?:think|thinking|thought|remember|remembering|memory|imagine|imagining|wish|wishing|wonder|wondering)\b/.test(value)) {
    return false
  }

  return (
    /\byou (?:go|goes|walk|walks|run|runs|drive|drives|head|heads|travel|travels|return|returns|enter|enters|arrive|arrives|follow|follows|leave|leaves|step|steps|cross|crosses|climb|climbs|move|moves|land|lands|wake|wakes|park|parks|pull|pulls)\b/.test(value) ||
    /\byou make your way\b/.test(value) ||
    /\byou (?:are|re) (?:led|taken|carried|brought|ushered|escorted|shown)\b/.test(value) ||
    /\b(?:leads|takes|carries|brings|ushers|escorts|shows) you\b/.test(value) ||
    /\b(?:when|by the time) you arrive\b/.test(value) ||
    /\bscene (?:cuts|shifts)\b/.test(value)
  )
}

// v0.6.19 (A1): collapse a transit pseudo-place name to its destination. The
// archivist prompt forbids names like "en route to X" (archivist-system.md),
// but Haiku produces them anyway (world 13 place 68, "En route to safe house").
// Such a name as the scene anchor is travel limbo — neither the vehicle nor the
// destination — which lets the narrator oscillate between them. We normalize the
// name to the destination so the anchor is a real place. Pure; no DB.
export function normalizeTransitPlaceName(name: string): string {
  const trimmed = name.trim()
  // "X - en route to Y" → Y
  const dashRoute = trimmed.match(/[-–—]\s*en\s*route\s+to\s+(.+)$/i)
  if (dashRoute?.[1]) return dashRoute[1].trim()
  // Leading transit framings → the destination after "to".
  const prefixed = trimmed.match(
    /^(?:en\s*route\s+to|heading\s+(?:back\s+)?to|on\s+(?:the\s+)?way\s+to|travel?ling\s+to|on\s+the\s+road\s+to)\s+(.+)$/i,
  )
  if (prefixed?.[1]) return prefixed[1].trim()
  // "not (yet) at X" → X
  const notAt = trimmed.match(/^not\s+(?:yet\s+)?at\s+(.+)$/i)
  if (notAt?.[1]) return notAt[1].trim()
  return trimmed
}

// Apply normalizeTransitPlaceName to every place name a patch can carry, on a
// shallow clone so the original (kept in turn metadata for audit) is untouched.
export function normalizeTransitPlacesInPatch(patch: ArchivistPatch): ArchivistPatch {
  const next: ArchivistPatch = { ...patch }
  if (next.places) {
    next.places = next.places.map((p) => ({ ...p, name: normalizeTransitPlaceName(p.name) }))
  }
  if (next.characters) {
    next.characters = next.characters.map((c) =>
      c.current_place_name === undefined
        ? c
        : { ...c, current_place_name: normalizeTransitPlaceName(c.current_place_name) },
    )
  }
  if (next.scene?.action === 'open') {
    next.scene = { ...next.scene, place_name: normalizeTransitPlaceName(next.scene.place_name) }
  }
  return next
}

export function canonicalPlaceKey(value: string): string {
  const withoutRouteNoise = value
    .replace(/\([^)]*\ben route\b[^)]*\)/gi, '')
    .replace(/\s+[-–—]\s+.*\ben route\b.*$/i, '')
    .replace(/\b(?:not yet at|on the way to|headed to)\b/gi, '')
    .replace(/\ben route to\s+/gi, '')
  const commaHead = withoutRouteNoise.split(',')[0] ?? withoutRouteNoise
  const dashHead = commaHead.split(/\s+[-–—]\s+/)[0] ?? commaHead
  return normalize(dashHead).replace(/^(?:the|his|her|their|our)\s+/, '')
}

export function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function containsAsPhrase(value: string, phrase: string): boolean {
  return ` ${value} `.includes(` ${phrase} `)
}

function canonicalCharacterKey(value: string): string {
  return characterTokens(value).join(' ')
}

const CHARACTER_TITLE_WORDS = new Set([
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

function characterTokens(value: string): string[] {
  return normalize(value)
    .split(' ')
    .filter((token) => token.length > 0 && !CHARACTER_TITLE_WORDS.has(token))
}
