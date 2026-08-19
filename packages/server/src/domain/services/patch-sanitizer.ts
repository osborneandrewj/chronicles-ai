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
import { playerPossesses } from '@/domain/services/inventory-resolution'
import { extractItemMovements, extractObjectAcquisition } from '@/domain/services/object-acquisition'
import {
  filterArchivistKnowledgeForAudience,
  type PrivateUtterance,
} from '@/domain/services/private-utterance'
import { shouldEscalateViolence } from '@/domain/services/violence-escalation'

type CharacterPatch = NonNullable<ArchivistPatch['characters']>[number]

export type DeterministicPatchOpts = {
  /** Collapse / stay-under / wake-advance: ignore "I head to X". */
  skipPlayerTravel?: boolean
  /** Wake-advance: land at this depicted place instead of the last typed walk. */
  wakePlace?: string | null
}

export function extractDeterministicPatch(
  prior: NarratorWorldState,
  playerText: string,
  narratorText: string,
  opts: DeterministicPatchOpts = {},
): ArchivistPatch | null {
  const patch: ArchivistPatch = {}

  const destination = opts.wakePlace
    ? opts.wakePlace
    : opts.skipPlayerTravel
      ? null
      : extractDestination(playerText, prior, narratorText)
  if (destination) {
    const destinationKey = normalize(destination)
    const player = prior.presentCharacters.find((c) => c.is_player === 1)
    const followedPlace = placeNameForFollowedPerson(playerText, prior)
    const followingThemThere =
      (followedPlace != null && normalize(followedPlace) === destinationKey) ||
      destinationIsNamedPersonsPlace(playerText, prior, destination)
    if (
      destinationKey &&
      destinationKey !== normalize(prior.currentPlace?.name ?? '') &&
      player &&
      (opts.wakePlace != null ||
        narratorAcceptsDestination(destination, narratorText) ||
        (followingThemThere && !travelBlocked(narratorText)) ||
        (playerNamedPlaceWithMotion(playerText, destination) &&
          hasActualMotion(normalize(narratorText)) &&
          !travelBlocked(narratorText)) ||
        (playerLeftCurrentPlace(playerText, prior) &&
          !travelBlocked(narratorText) &&
          narratorMentionsPlace(narratorText, destination)))
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

  // Drops and gives. A player can only move an object the ledger says they hold
  // (the playerPossesses gate), so a loose pattern match never fabricates a
  // phantom move. Drop → the object rests at the protagonist's current place
  // (mutual exclusion clears the holder in apply); give → the named recipient
  // becomes the holder.
  const movements = extractItemMovements(playerText, narratorText)
  if (movements.length > 0) {
    const resources = patch.story_resources ?? []
    for (const move of movements) {
      if (!playerPossesses(prior, move.object)) continue
      if (move.type === 'drop') {
        const here = prior.currentPlace?.name
        resources.push(
          here ? { name: move.object, location_name: here } : { name: move.object, held_by_name: null },
        )
      } else {
        resources.push({ name: move.object, held_by_name: move.recipient })
      }
    }
    if (resources.length > 0) patch.story_resources = resources
  }

  // PR E: public violence / superhuman cost — deterministic dossier suggestions
  // so institutional aftermath does not depend solely on the archivist opting in.
  // Skip when an active threat already covers the same title (no spam).
  const escalation = shouldEscalateViolence({
    narration: narratorText,
    playerText,
    placeName: prior.currentPlace?.name ?? null,
    placeKind: prior.currentPlace?.kind ?? null,
    presentNpcNames: prior.presentCharacters
      .filter((c) => c.is_player !== 1)
      .map((c) => c.name),
  })
  if (escalation.threat) {
    const already = prior.dossier.threads.some(
      (t) =>
        t.status === 'active' &&
        t.kind === 'threat' &&
        normalize(t.title) === normalize(escalation.threat!.title),
    )
    if (!already) {
      patch.story_threads = [
        ...(patch.story_threads ?? []),
        {
          title: escalation.threat.title,
          kind: 'threat',
          status: 'active',
          summary: escalation.threat.summary,
          stakes: escalation.threat.stakes,
          consequences: escalation.threat.consequences,
        },
      ]
    }
  }
  if (escalation.timelineEvent) {
    patch.timeline_events = [
      ...(patch.timeline_events ?? []),
      {
        title: escalation.timelineEvent.title,
        summary: escalation.timelineEvent.summary,
        importance: escalation.timelineEvent.importance,
      },
    ]
  }
  if (escalation.resource) {
    patch.story_resources = [
      ...(patch.story_resources ?? []),
      {
        name: escalation.resource.name,
        kind: escalation.resource.kind,
        detail: escalation.resource.detail,
        held_by_name: escalation.resource.held_by_name,
        salient: true,
      },
    ]
  }

  return Object.keys(patch).length > 0 ? patch : null
}

/**
 * Overlay a deterministic travel patch onto an LLM archivist patch.
 * The LLM often moves NPCs and forgets the protagonist; travel the player
 * authored and the narrator confirmed must still land.
 */
export function mergeDeterministicTravel(
  llmPatch: ArchivistPatch,
  deterministic: ArchivistPatch | null,
): ArchivistPatch {
  if (!deterministic) return llmPatch
  const merged: ArchivistPatch = { ...llmPatch }
  const playerMove = deterministic.characters?.find(
    (c) => c.is_player === true && c.current_place_name,
  )
  if (playerMove?.current_place_name) {
    const dest = playerMove.current_place_name
    const chars = [...(merged.characters ?? [])]
    const idx = chars.findIndex((c) => c.is_player === true || c.name === playerMove.name)
    if (idx >= 0) {
      if (!chars[idx].current_place_name) {
        chars[idx] = { ...chars[idx], current_place_name: dest }
      }
    } else {
      chars.push(playerMove)
    }
    merged.characters = chars
    if (deterministic.places) {
      merged.places = [...(merged.places ?? []), ...deterministic.places]
    }
    if (
      deterministic.scene?.action === 'open' &&
      (!merged.scene || merged.scene.action === 'keep_open')
    ) {
      merged.scene = deterministic.scene
    }
  }
  return merged
}

/**
 * When the protagonist cannot act, drop player travel unless it is the
 * depicted wake place. NPC moves stay.
 */
export function constrainPlayerTravel(
  patch: ArchivistPatch,
  allowedPlace: string | null,
): ArchivistPatch {
  const next: ArchivistPatch = { ...patch }
  const allowed = allowedPlace ? canonicalPlaceKey(allowedPlace) : null

  if (next.scene?.action === 'open') {
    const dest = canonicalPlaceKey(next.scene.place_name)
    if (!allowed || dest !== allowed) delete next.scene
  }

  if (next.characters) {
    const characters = next.characters.map((c) => {
      if (c.is_player !== true || !c.current_place_name) return c
      const dest = canonicalPlaceKey(c.current_place_name)
      if (allowed && dest === allowed) return c
      const rest = { ...c }
      delete rest.current_place_name
      return rest
    })
    next.characters = characters.filter(hasMeaningfulCharacterPatch)
    if (next.characters.length === 0) delete next.characters
  }
  return next
}

/** Place they wake, from narrator prose. Known names first; cot/med-station → Medical. */
export function extractWakePlace(
  narratorText: string,
  knownPlaceNames: string[],
): string | null {
  const match =
    /\byou wake(?:s|d)?\b[\s\S]{0,320}/i.exec(narratorText) ||
    /\bwhen awareness returns\b[\s\S]{0,320}/i.exec(narratorText) ||
    /\byou (?:are|wake) (?:on|in) the (?:cot|couch|table)\b[\s\S]{0,200}/i.exec(
      narratorText,
    )
  if (!match) return null
  const window = match[0].toLowerCase()
  const names = [...knownPlaceNames]
    .filter((n) => n.trim().length >= 3)
    .sort((a, b) => b.length - a.length)
  for (const name of names) {
    const key = name.toLowerCase()
    if (!window.includes(key)) continue
    if (/\bisolation\b/.test(key) && /\bnot in sight\b/.test(window)) continue
    return name
  }
  if (/\b(cot|med-?station|medical bay|examination (?:couch|table))\b/.test(window)) {
    return names.find((n) => /^medical$/i.test(n.trim())) ?? 'Medical'
  }
  return null
}

export function sanitizeArchivistPatch(
  prior: NarratorWorldState,
  recent: Array<{ role: 'user' | 'assistant'; content: string }>,
  patch: ArchivistPatch,
  privateUtterance: PrivateUtterance | null = null,
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

  // Private-channel knowledge partition: non-audience NPCs never persist
  // observations about private speech (structure first; prompt is soft only).
  const knownForAudience = prior.knownCharacters.map((c) => ({
    id: c.id,
    name: c.name,
    aliases: c.aliases,
    is_player: c.is_player,
    status: c.status,
  }))
  return filterArchivistKnowledgeForAudience(sanitized, privateUtterance, knownForAudience)
}

function extractDestination(
  text: string,
  prior: NarratorWorldState,
  narratorText = '',
): string | null {
  const patterns = [
    /\b(?:i\s+)?(?:go|walk|run|drive|head|travel)\s+(?:back\s+)?to\s+(?:the\s+)?([^.!?\n,;]{3,80})/i,
    /\b(?:i\s+)?(?:return)\s+to\s+(?:the\s+)?([^.!?\n,;]{3,80})/i,
    /\b(?:i\s+)?(?:enter|walk into|go into)\s+(?:the\s+)?([^.!?\n,;]{3,80})/i,
    /\b(?:i\s+)?make my way to\s+(?:the\s+)?([^.!?\n,;]{3,80})/i,
    // "I groan and follow him to medical" — follow is the travel verb.
    /\bfollow(?:s|ed|ing)?\s+(?:[\w'.]+\s+){0,5}to\s+(?:the\s+)?([^.!?\n,;]{3,80})/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match?.[1]) continue
    const destination = cleanDestination(match[1])
    if (!destination) continue
    const asPerson = placeNameForCharacter(prior, destination)
    if (asPerson) return asPerson
    const known = knownPlaceName(prior, destination)
    return known ?? destination
  }
  const followedPlace = placeNameForFollowedPerson(text, prior)
  if (followedPlace) return followedPlace
  const leftFor = extractLeaveTravel(text, narratorText, prior)
  if (leftFor) return leftFor
  return extractPlaceWithMotion(text, prior)
}

function extractFollowedPerson(text: string): string | null {
  const match = text.match(
    /\bfollow(?:s|ed|ing)?\s+(?:the\s+)?(?!to\b)([A-Za-z][\w'.-]*)(?:\s+([A-Z][\w'.-]*))?/,
  )
  if (!match?.[1]) return null
  if (/^(him|her|them|it|this|that|me|us|you)$/i.test(match[1])) return null
  return match[2] ? `${match[1]} ${match[2]}` : match[1]
}

function placeNameForFollowedPerson(
  text: string,
  prior: NarratorWorldState,
): string | null {
  const name = extractFollowedPerson(text)
  return name ? placeNameForCharacter(prior, name) : null
}

function placeNameForCharacter(
  prior: NarratorWorldState,
  rawName: string,
): string | null {
  const key = normalize(rawName)
  if (key.length < 3) return null
  const chars = [...prior.knownCharacters, ...prior.presentCharacters]
  const hit = chars.find((c) => {
    if (c.is_player === 1) return false
    const n = normalize(c.name)
    return n === key || n.startsWith(`${key} `) || n.split(' ')[0] === key
  })
  if (!hit?.current_place_id) return null
  return prior.knownPlaces.find((p) => p.id === hit.current_place_id)?.name ?? null
}

function knownPlaceName(prior: NarratorWorldState, raw: string): string | null {
  const key = canonicalPlaceKey(raw)
  const hit = prior.knownPlaces.find((p) => canonicalPlaceKey(p.name) === key)
  if (hit) return hit.name
  return (
    prior.knownPlaces.find((p) => canonicalPlaceKey(p.name).includes(key) && key.length >= 4)
      ?.name ?? null
  )
}

function extractPlaceWithMotion(
  text: string,
  prior: NarratorWorldState,
): string | null {
  if (
    !/\b(go|walk|run|head|enter|follow|find a table|get food|sit|arrive|meet|lead the way|make my way)\b/i.test(
      text,
    )
  ) {
    return null
  }
  const leaving = playerLeftCurrentPlace(text, prior)
  const currentKey = prior.currentPlace ? canonicalPlaceKey(prior.currentPlace.name) : ''
  const ranked = [...prior.knownPlaces].sort((a, b) => b.name.length - a.name.length)
  const n = normalize(text)
  for (const p of ranked) {
    if (p.name.trim().length < 3) continue
    if (!containsAsPhrase(n, normalize(p.name)) && !mentionsPlaceAlias(n, p.name)) continue
    if (leaving && canonicalPlaceKey(p.name) === currentKey) continue
    return p.name
  }
  return null
}

function extractLeaveTravel(
  playerText: string,
  narratorText: string,
  prior: NarratorWorldState,
): string | null {
  if (!playerLeftCurrentPlace(playerText, prior)) return null
  const currentId = prior.currentPlace?.id ?? null
  const narrator = normalize(narratorText)
  const hits: Array<{ name: string; idx: number }> = []
  for (const p of prior.knownPlaces) {
    if (p.id === currentId || p.name.trim().length < 4) continue
    const key = normalize(p.name)
    let idx = narrator.indexOf(key)
    if (idx < 0) {
      const alias = key.split(' ').filter((w) => w.length >= 4)[0]
      idx = alias ? narrator.indexOf(alias) : -1
    }
    if (idx < 0) continue
    hits.push({ name: p.name, idx })
  }
  hits.sort((a, b) => a.idx - b.idx)
  for (const hit of hits) {
    const around = windowAroundPhrase(narrator, normalize(hit.name), 14)
    if (/\b(glanc(?:e|ing)|look(?:s|ing)? (?:at|toward))\b/.test(around)) continue
    const futureOnly =
      /\b(will|we'll|we will|need to|in search of|pull what)\b/.test(around) &&
      !hasActualMotion(around)
    if (futureOnly) continue
    return hit.name
  }
  return null
}

function playerLeftCurrentPlace(
  playerText: string,
  prior: NarratorWorldState,
): boolean {
  const n = normalize(playerText)
  if (!/\b(leave|leaving|head(?:s|ing)? off|let's go|lets go)\b/.test(n)) return false
  const current = prior.currentPlace?.name
  if (!current) return true
  return mentionsPlaceAlias(n, current) || /\b(head(?:s|ing)? off|let's go|lets go)\b/.test(n)
}

function mentionsPlaceAlias(haystack: string, placeName: string): boolean {
  const key = normalize(placeName)
  if (containsAsPhrase(haystack, key)) return true
  return key
    .split(' ')
    .filter((w) => w.length >= 4)
    .some((w) => containsAsPhrase(haystack, w))
}

function narratorMentionsPlace(narratorText: string, placeName: string): boolean {
  return mentionsPlaceAlias(normalize(narratorText), placeName)
}

function playerNamedPlaceWithMotion(playerText: string, destination: string): boolean {
  if (
    !/\b(go|walk|run|head|enter|follow|find a table|get food|sit|arrive|meet|lead the way|make my way)\b/i.test(
      playerText,
    )
  ) {
    return false
  }
  return containsAsPhrase(normalize(playerText), normalize(destination))
}

function destinationIsNamedPersonsPlace(
  playerText: string,
  prior: NarratorWorldState,
  destination: string,
): boolean {
  const match = playerText.match(
    /\b(?:to|toward)\s+(?:the\s+)?([A-Za-z][\w'.-]*)(?:\s+([A-Z][\w'.-]*))?/,
  )
  if (!match?.[1]) return false
  if (/^(the|a|an|my|his|her|their)$/i.test(match[1])) return false
  const name = match[2] ? `${match[1]} ${match[2]}` : match[1]
  const place = placeNameForCharacter(prior, name)
  return place != null && normalize(place) === normalize(destination)
}

function travelBlocked(narratorText: string): boolean {
  const n = normalize(narratorText)
  return (
    /\b(blocks? you|blocked the (?:road|way|door)|cannot (?:pass|enter|leave)|floodwater)\b/.test(
      n,
    ) && !/\b(arrive|follow|fall in step|beside you|leads you)\b/.test(n)
  )
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
    /\bmake (?:your|my) way\b/.test(value) ||
    /\byou and \w+ (?:reach|walk|go|head|arrive|enter|sit|take)\b/.test(value) ||
    /\byou (?:are|re) (?:led|taken|carried|brought|ushered|escorted|shown)\b/.test(value) ||
    /\b(?:leads|takes|carries|brings|ushers|escorts|shows) you\b/.test(value) ||
    /\bfall(?:s)? in step\b/.test(value) ||
    /\bleads? without\b/.test(value) ||
    /\bdoorway opens\b/.test(value) ||
    /\bopens ahead\b/.test(value) ||
    /\b(?:when|by the time) you arrive\b/.test(value) ||
    /\bscene (?:cuts|shifts)\b/.test(value) ||
    /\bthe two of you leave\b/.test(value) ||
    /\bleave(?:s|ing)? the .{0,40} behind\b/.test(value)
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
  // No dash-head collapse: a " - " suffix is ambiguous between a sub-room
  // ("33rd Street house - kitchen") and a distinct sibling district
  // ("Thebes - canal path" vs "Thebes - outer path"). Collapsing on the head
  // merged every "City - District" name onto the first district created, so the
  // player could never actually leave it and co-located NPCs stayed "local"
  // forever. Sub-room equivalence is decided by placesMatch (containsAsPhrase +
  // PLACE_DETAIL_WORDS); the canonical key keeps the full distinguishing name.
  return normalize(commaHead).replace(/^(?:the|his|her|their|our)\s+/, '')
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
