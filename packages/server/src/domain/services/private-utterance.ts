// Pure private-utterance detect / audience / digest / knowledge filter.
// Structure-first privacy for whispers, asides, texts, DMs, and private calls.
// No I/O. Conservative detection: channel verb + resolved known non-player name(s).
// Soft prompts reinforce; durable stamp + filters enforce.

export type PrivateChannel = 'whisper' | 'aside' | 'text' | 'dm' | 'private_call'

export type PrivateUtteranceStatus = 'active' | 'expired'

export type PrivateUtterance = {
  channel: PrivateChannel
  /** Character ids allowed to know the content this turn (and persist knowledge). */
  audienceCharacterIds: number[]
  audienceNames: string[]
  /** Optional excerpt for debug / agent private context (not printed as mechanics). */
  contentHint?: string
  createdTurnId: number
  /**
   * If true, co-located non-audience may overhear (failed stealth / loud whisper).
   * v1 default false; true only when player text implies loudness.
   */
  mayOverhear: boolean
  status: PrivateUtteranceStatus
}

export type KnownCharacterForPrivate = {
  id: number
  name: string
  aliases?: string | null
  is_player?: number
  status?: string
}

/** Character patch fields the audience filter may strip. */
export type ArchivistCharacterKnowledgePatch = {
  name: string
  observations_append?: string
  is_player?: boolean
  [key: string]: unknown
}

export type ArchivistPatchForAudience = {
  characters?: ArchivistCharacterKnowledgePatch[]
  [key: string]: unknown
}

// ── detection ──────────────────────────────────────────────────────────────

/**
 * Detect a private channel from a single player utterance naming known
 * non-player character(s). Returns null for public speech or unresolvable names.
 */
export function detectPrivateUtterance(
  playerText: string,
  knownCharacters: KnownCharacterForPrivate[],
  createdTurnId: number,
): PrivateUtterance | null {
  const compact = normalize(playerText)
  if (!compact) return null

  const channel = classifyChannel(compact)
  if (!channel) return null

  const candidates = knownCharacters.filter(
    (c) => c.is_player !== 1 && c.status !== 'dead' && c.name.trim().length > 0,
  )
  if (candidates.length === 0) return null

  const audience = resolveAudience(compact, channel, candidates)
  if (audience.length === 0) return null

  // Stable order: first mention order in text, then id.
  const ordered = orderByMention(compact, audience)

  return {
    channel,
    audienceCharacterIds: ordered.map((c) => c.id),
    audienceNames: ordered.map((c) => c.name),
    contentHint: extractContentHint(playerText),
    createdTurnId,
    mayOverhear: impliesMayOverhear(compact, channel),
    status: 'active',
  }
}

export function isAudience(
  characterId: number,
  utterance: PrivateUtterance | null | undefined,
): boolean {
  if (!utterance || utterance.status !== 'active') return false
  return utterance.audienceCharacterIds.includes(characterId)
}

export function isAudienceByName(
  name: string,
  utterance: PrivateUtterance | null | undefined,
  knownCharacters: KnownCharacterForPrivate[] = [],
): boolean {
  if (!utterance || utterance.status !== 'active') return false
  const key = canonicalNameKey(name)
  if (utterance.audienceNames.some((n) => canonicalNameKey(n) === key)) return true
  // Resolve via known character id when the patch uses an alias.
  const match = knownCharacters.find((c) => nameMatchesCharacter(name, c))
  if (match && utterance.audienceCharacterIds.includes(match.id)) return true
  return false
}

// ── agent / narrator digests ───────────────────────────────────────────────

/**
 * Coarse public prior for NPC agent ticks when a private utterance is active.
 * Avoids feeding private content as shared prior to every agent in a batch.
 */
export function publicDigest(
  priorNarration: string,
  utterance: PrivateUtterance | null | undefined,
): string {
  if (!utterance || utterance.status !== 'active') return priorNarration
  if (!priorNarration.trim()) return priorNarration

  const audience =
    utterance.audienceNames.length === 1
      ? utterance.audienceNames[0]
      : utterance.audienceNames.join(' and ')

  // Prefer redacting quoted private spans when present; fall back to a short
  // public digest so free-prose secrets do not ride as shared knowledge.
  const redacted = redactQuotedPrivateSpans(priorNarration, utterance)
  if (redacted !== priorNarration) return redacted

  return `[Prior beat — private exchange with ${audience} redacted; content not known to non-audience]`
}

/**
 * Player-action line shown to an NPC agent for the current turn.
 * Audience gets the full text; non-audience gets a redacted notice.
 */
export function playerTextForNpc(
  playerText: string,
  characterId: number,
  utterance: PrivateUtterance | null | undefined,
): string {
  if (!utterance || utterance.status !== 'active') return playerText
  if (isAudience(characterId, utterance)) return playerText

  const audience =
    utterance.audienceNames.length === 1
      ? utterance.audienceNames[0]
      : utterance.audienceNames.join(' and ')
  const channelLabel = channelPublicLabel(utterance.channel)
  return `[Player spoke privately to ${audience} via ${channelLabel} — content not audible to you]`
}

/** Default (non-audience) player-action line for a batch agent message. */
export function redactedPlayerTextForNonAudience(
  utterance: PrivateUtterance,
): string {
  const audience =
    utterance.audienceNames.length === 1
      ? utterance.audienceNames[0]
      : utterance.audienceNames.join(' and ')
  return `[Player spoke privately to ${audience} via ${channelPublicLabel(utterance.channel)} — content not audible to non-audience]`
}

// ── archivist knowledge write filter ───────────────────────────────────────

/**
 * Drop non-audience `observations_append` (and clear empty character rows) when
 * a private utterance is active. Player rows are never filtered for this field
 * (observations on PC are already dropped elsewhere). No-op when no utterance.
 */
export function filterArchivistKnowledgeForAudience<T extends ArchivistPatchForAudience>(
  patch: T,
  utterance: PrivateUtterance | null | undefined,
  knownCharacters: KnownCharacterForPrivate[] = [],
): T {
  if (!utterance || utterance.status !== 'active') return patch
  if (!patch.characters || patch.characters.length === 0) return patch

  const characters = patch.characters
    .map((c) => {
      if (c.observations_append === undefined) return c
      if (c.is_player === true) return c
      if (isAudienceByName(c.name, utterance, knownCharacters)) return c
      const rest = { ...c }
      delete rest.observations_append
      return rest
    })
    .filter((c) => hasMeaningfulCharacterFields(c))

  const next = { ...patch }
  if (characters.length > 0) {
    next.characters = characters
  } else {
    delete next.characters
  }
  return next
}

// ── metadata ───────────────────────────────────────────────────────────────

/** Serialize for turn metadata (mergeMetadata block under `private_utterance`). */
export function privateUtteranceToMetadata(
  utterance: PrivateUtterance,
): Record<string, unknown> {
  return {
    channel: utterance.channel,
    audienceCharacterIds: utterance.audienceCharacterIds,
    audienceNames: utterance.audienceNames,
    createdTurnId: utterance.createdTurnId,
    mayOverhear: utterance.mayOverhear,
    status: utterance.status,
    ...(utterance.contentHint ? { contentHint: utterance.contentHint } : {}),
  }
}

/** Parse a metadata block back into PrivateUtterance (or null if malformed). */
export function privateUtteranceFromMetadata(raw: unknown): PrivateUtterance | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const channel = o.channel
  if (!isPrivateChannel(channel)) return null

  const audienceCharacterIds = Array.isArray(o.audienceCharacterIds)
    ? o.audienceCharacterIds.map(Number).filter((n) => Number.isFinite(n))
    : []
  const audienceNames = Array.isArray(o.audienceNames)
    ? o.audienceNames.filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
    : []
  if (audienceCharacterIds.length === 0 || audienceNames.length === 0) return null

  const createdTurnId = Number(o.createdTurnId)
  if (!Number.isFinite(createdTurnId)) return null

  const status = o.status === 'expired' ? 'expired' : o.status === 'active' ? 'active' : null
  if (!status) return null

  return {
    channel,
    audienceCharacterIds,
    audienceNames,
    createdTurnId,
    mayOverhear: o.mayOverhear === true,
    status,
    ...(typeof o.contentHint === 'string' && o.contentHint.trim()
      ? { contentHint: o.contentHint.trim() }
      : {}),
  }
}

// ── internals ──────────────────────────────────────────────────────────────

function classifyChannel(compact: string): PrivateChannel | null {
  // Order matters: more specific private_call / dm / text before generic whisper.
  if (
    /\b(private\s+call|call\s+\w[\w\s]{0,40}\s+privately|phone\s+\w[\w\s]{0,40}\s+(in\s+)?private|facetime|face\s*time|private\s+phone)\b/i.test(
      compact,
    ) ||
    /\b(call|phone|ring)\b[\s\S]{0,40}\bprivately\b/i.test(compact)
  ) {
    return 'private_call'
  }

  if (
    /\b(dm|direct\s+message|i\s*message|imessage|whatsapp|signal\s+message)\b/i.test(compact) ||
    /\b(dm|direct[\s-]?message)\s+/i.test(compact)
  ) {
    return 'dm'
  }

  if (
    /\b(text|texts|texting|texted|text\s+message|sms|message)\b/i.test(compact) &&
    // "message" alone is noisy — require message-to / text-to / text X shape.
    (/\b(text|texts|texting|texted|sms)\b/i.test(compact) ||
      /\b(message|messages|messaging|messaged)\s+(to\s+)?/i.test(compact) ||
      /\b(send|sends|sent)\s+(a\s+)?(text|message|dm)\b/i.test(compact))
  ) {
    // Prefer text over dm when both "text" and "message" appear without DM keywords.
    if (/\b(dm|direct\s+message)\b/i.test(compact)) return 'dm'
    return 'text'
  }

  if (/\b(aside\s+to|asides?\s+to|lean\s+aside)\b/i.test(compact)) {
    return 'aside'
  }

  if (
    /\b(whisper|whispers|whispering|whispered|murmur|murmurs|murmuring|mutter|mutters|muttering)\b/i.test(
      compact,
    ) ||
    /\blean(s|ed|ing)?\s+in\b/i.test(compact) ||
    /\bunder\s+(my|his|her|their)\s+breath\b/i.test(compact) ||
    /\bin\s+(a\s+)?(low|quiet|hushed)\s+(voice|tone)\b/i.test(compact)
  ) {
    return 'whisper'
  }

  return null
}

function resolveAudience(
  compact: string,
  channel: PrivateChannel,
  candidates: KnownCharacterForPrivate[],
): KnownCharacterForPrivate[] {
  // Prefer longer names first so "Andy Osborne" beats "Andy".
  const ranked = [...candidates].sort((a, b) => b.name.length - a.name.length)
  const found: KnownCharacterForPrivate[] = []
  const foundIds = new Set<number>()

  for (const c of ranked) {
    if (foundIds.has(c.id)) continue
    const names = characterNameVariants(c)
    for (const name of names) {
      if (!nameMentions(compact, name)) continue
      // Require the name to sit near the channel verb (avoid "I whisper to Marcus
      // about Kyle" pulling Kyle into the audience solely from content).
      if (!nameNearChannel(compact, name, channel)) continue
      found.push(c)
      foundIds.add(c.id)
      break
    }
  }

  return found
}

function nameNearChannel(
  compact: string,
  name: string,
  channel: PrivateChannel,
): boolean {
  const escaped = escapeRegExp(name.trim().toLowerCase())
  // Name within ~50 chars of a channel cue, or after "to/with/at".
  const near =
    new RegExp(
      `\\b(whisper|whispers|whispering|whispered|murmur|mutter|aside|lean|leans|leaned|leaning|text|texts|texting|texted|dm|message|messages|messaging|messaged|call|calls|calling|called|phone|phones|phoning|phoned|facetime|sms|imessage|i\\s*message|whatsapp|signal)\\b[\\s\\S]{0,50}\\b${escaped}\\b|\\b${escaped}\\b[\\s\\S]{0,40}\\b(whisper|whispers|privately|private|quietly|aside)\\b|\\b(to|with|at)\\s+${escaped}\\b`,
      'i',
    ).test(compact)

  if (near) return true

  // Multi-audience: "to Marcus and Kyle" after a channel verb already matched.
  if (
    new RegExp(
      `\\b(to|with)\\s+[\\w\\s,]{0,60}\\band\\s+${escaped}\\b|\\b${escaped}\\s+and\\b`,
      'i',
    ).test(compact)
  ) {
    // Only if a channel verb appears somewhere (already true if we got here
    // via classifyChannel) — accept "whisper to Marcus and Kyle".
    return channel === 'whisper' || channel === 'aside' || channel === 'text' || channel === 'dm'
  }

  return false
}

function orderByMention(
  compact: string,
  audience: KnownCharacterForPrivate[],
): KnownCharacterForPrivate[] {
  return [...audience].sort((a, b) => {
    const ia = firstMentionIndex(compact, a)
    const ib = firstMentionIndex(compact, b)
    if (ia !== ib) return ia - ib
    return a.id - b.id
  })
}

function firstMentionIndex(compact: string, c: KnownCharacterForPrivate): number {
  let best = Number.POSITIVE_INFINITY
  for (const name of characterNameVariants(c)) {
    const n = name.trim().toLowerCase()
    if (n.length < 2) continue
    const idx = compact.indexOf(n)
    if (idx >= 0 && idx < best) best = idx
  }
  return best
}

function impliesMayOverhear(compact: string, channel: PrivateChannel): boolean {
  // Text / DM / private_call are never overhearable by co-present NPCs in v1.
  if (channel === 'text' || channel === 'dm' || channel === 'private_call') return false
  return (
    /\b(loud|loudly|too\s+loud|loud\s+enough|everyone\s+(can|could)\s+hear|fails?\s+(stealth|to\s+whisper)|slips?\s+out\s+loud|raises?\s+(my|his|her|their)\s+voice)\b/i.test(
      compact,
    )
  )
}

function extractContentHint(playerText: string): string | undefined {
  // Prefer a quoted span; else omit (do not restate free prose into STATE).
  const quoted =
    playerText.match(/["“]([^"”]{3,120})["”]/)?.[1] ??
    playerText.match(/'([^']{3,120})'/)?.[1]
  if (!quoted) return undefined
  const hint = quoted.replace(/\s+/g, ' ').trim()
  return hint.length > 0 ? hint.slice(0, 100) : undefined
}

function redactQuotedPrivateSpans(
  priorNarration: string,
  utterance: PrivateUtterance,
): string {
  if (!utterance.contentHint) return priorNarration
  const hint = utterance.contentHint.trim()
  if (hint.length < 4) return priorNarration
  // Case-insensitive replace of the known secret span.
  const pattern = new RegExp(escapeRegExp(hint), 'gi')
  if (!pattern.test(priorNarration)) return priorNarration
  const audience =
    utterance.audienceNames.length === 1
      ? utterance.audienceNames[0]
      : utterance.audienceNames.join(' and ')
  return priorNarration.replace(
    new RegExp(escapeRegExp(hint), 'gi'),
    `[private to ${audience} — content redacted]`,
  )
}

function channelPublicLabel(channel: PrivateChannel): string {
  switch (channel) {
    case 'whisper':
      return 'whisper'
    case 'aside':
      return 'aside'
    case 'text':
      return 'text'
    case 'dm':
      return 'DM'
    case 'private_call':
      return 'private call'
  }
}

function isPrivateChannel(value: unknown): value is PrivateChannel {
  return (
    value === 'whisper' ||
    value === 'aside' ||
    value === 'text' ||
    value === 'dm' ||
    value === 'private_call'
  )
}

function hasMeaningfulCharacterFields(c: ArchivistCharacterKnowledgePatch): boolean {
  // Keep the row if any field besides name / is_player remains after stripping.
  for (const [key, value] of Object.entries(c)) {
    if (key === 'name' || key === 'is_player') continue
    if (value !== undefined) return true
  }
  return false
}

function characterNameVariants(c: KnownCharacterForPrivate): string[] {
  const names = [c.name.trim()]
  if (c.aliases) {
    for (const a of c.aliases.split(/[\n,;]/)) {
      const t = a.trim()
      if (t.length >= 2) names.push(t)
    }
  }
  const first = c.name.trim().split(/\s+/)[0]
  if (first && first.length >= 3 && !names.some((n) => n.toLowerCase() === first.toLowerCase())) {
    names.push(first)
  }
  return names
}

function nameMentions(compact: string, name: string): boolean {
  const n = name.trim().toLowerCase()
  if (n.length < 2) return false
  return new RegExp(`\\b${escapeRegExp(n)}\\b`, 'i').test(compact)
}

function nameMatchesCharacter(name: string, c: KnownCharacterForPrivate): boolean {
  const key = canonicalNameKey(name)
  return characterNameVariants(c).some((v) => canonicalNameKey(v) === key)
}

function canonicalNameKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
