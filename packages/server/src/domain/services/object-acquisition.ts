// Pure domain service (Phase A, A4) — deterministic object-acquisition
// extraction. Mirrors `extractDestination` in patch-sanitizer: a player whose
// text clearly takes, pockets, grabs, buys, or is handed an object should have
// that object promoted into the tracked-object ledger held_by the protagonist —
// WITHOUT depending on the archivist LLM opting in.
//
// No I/O — given the player's text and the narrator's response, returns the
// object name to promote (or null). Acceptance requires a word-boundary match
// of the object (or a synonym) near a possession-shaped verb/outcome in the
// narration, so a blocked grab, a distant synonym mention, or a currency line
// does not mint a phantom resource.

// Active takes / purchases are matched against the PLAYER's text only — the
// player is the implicit "I" subject, so an NPC grabbing something in the
// narration is not mis-attributed to the protagonist.
const ACTIVE_PATTERNS: RegExp[] = [
  // take / grab / pick up / pocket / snatch / seize / lift / swipe / collect /
  // retrieve / pluck / accept / buy / purchase / pay for
  /\b(?:i\s+)?(?:take|grab|pick\s+up|pocket|snatch|seize|lift|swipe|collect|retrieve|pluck|accept|buy|purchase|pay\s+for)\s+(?:the\s+|a\s+|an\s+|my\s+|his\s+|her\s+|their\s+|its\s+)?([^.!?\n,;]{2,60})/i,
  // "sheathe / belt / strap on my new X" — post-purchase possession language
  /\b(?:i\s+)?(?:sheathe|belt|strap\s+on|buckle\s+on|slide)\s+(?:the\s+|a\s+|an\s+|my\s+)?(?:new\s+)?([^.!?\n,;]{2,60})/i,
]

// Passive receipts are matched against the NARRATOR's text — being handed an
// object is described in narration. The `(?:me|you)` requirement keeps a
// handover to someone else ("hands Torres the key") from matching.
const RECEIVE_PATTERNS: RegExp[] = [
  /\b(?:hand(?:s|ed)?|give(?:s)?|gave|pass(?:es|ed)?|toss(?:es|ed)?|offer(?:s|ed)?)\s+(?:me|you)\s+(?:the\s+|a\s+|an\s+)?([^.!?\n,;]{2,60})/i,
]

// Words that are not really objects — guard against "I take a look", "I take a
// breath", "I take cover", "I grab her hand", currency payments, etc.
const NON_OBJECT_HEADS = new Set([
  'look',
  'breath',
  'breather',
  'cover',
  'aim',
  'stock',
  'note',
  'notes',
  'step',
  'seat',
  'turn',
  'moment',
  'chance',
  'risk',
  'shot',
  'hand',
  'hold',
  'lead',
  'charge',
  'control',
  'command',
  'comfort',
  'pride',
  'care',
  'time',
  'place',
  'side',
  'point',
  'rest',
  'position',
  // Currency / payment — never mint or move a tracked object for a price line.
  'drachmae',
  'drachma',
  'coins',
  'coin',
  'silver',
  'obols',
  'obol',
  'payment',
  'denarii',
  'denarius',
  'aurei',
  'aureus',
  'sesterces',
  'sestertius',
  'coppers',
  'copper',
  'gold',
  'money',
  'cash',
  'change',
  'price',
  'fee',
  'fare',
  'talents',
  'talent',
  'shekels',
  'shekel',
  'dollars',
  'dollar',
  'credits',
  'credit',
  'thrones',
  'throne',
])

// Small, data-driven synonym classes for period/player language drift.
// Canonical name is the first entry (preferred player-facing mint name when the
// player used any member of the class). Extensible — add rows, do not free-form
// LLM synonym expansion on every token.
const OBJECT_SYNONYM_CLASSES: readonly (readonly string[])[] = [
  ['sword', 'xiphos', 'gladius', 'blade', 'sabre', 'saber', 'cutlass'],
  ['knife', 'dagger', 'pugio', 'dirk'],
  ['cloak', 'himation', 'chlamys', 'mantle'],
]

// Possession-shaped outcomes in narrator prose. A match only counts when the
// accepted object name/synonym co-occurs with one of these inside a window.
const POSSESSION_MARKERS: RegExp[] = [
  /\blift(?:s|ed|ing)?\b/i,
  /\bclose(?:s|d)?\s+around\b/i,
  /\bhand(?:s|ed)?\b/i,
  /\btake(?:s|n|ing)?\b/i,
  /\bbuckle(?:s|d|ing)?\b/i,
  /\bsheathe(?:s|d|ing)?\b/i,
  /\bbelt(?:s|ed|ing)?\b/i,
  /\bat\s+your\s+hip\b/i,
  /\binto\s+your\b/i,
  /\binto\s+(?:a\s+|the\s+)?(?:pocket|jacket|bag|pack|satchel|belt|sheath|holster)\b/i,
  /\byour\s+hand\b/i,
  /\bslip(?:s|ped|ping)?\b/i,
  /\bpass(?:es|ed|ing)?\b/i,
  /\boffer(?:s|ed|ing)?\b/i,
  /\bgive(?:s|n)?\b/i,
  /\bgave\b/i,
  /\bweigh(?:s|ed|ing)?\b/i,
  /\bsettling\b/i,
  /\bheft(?:s|ed|ing)?\b/i,
  /\bgrasp(?:s|ed|ing)?\b/i,
  /\bclutch(?:es|ed|ing)?\b/i,
  /\baccept(?:s|ed|ing)?\b/i,
  /\breceive(?:s|d|ing)?\b/i,
  /\bpocket(?:s|ed|ing)?\b/i,
  /\bstrap(?:s|ped|ping)?\b/i,
  /\bslide(?:s|d|ing)?\b/i,
  /\boutstretched\b/i,
  /\bgrip(?:s|ped|ping)?\b/i,
]

// Denial / failed-transfer language near the object → do not mint.
const DENIAL_MARKERS: RegExp[] = [
  /\bout\s+of\s+reach\b/i,
  /\bknocks?\s+(?:your|the)\s+hand\b/i,
  /\bbefore\s+you\s+reach\b/i,
  /\bnot\s+there\b/i,
  /\bempty\b/i,
  /\bkeeps?\s+(?:the\s+)?\w+\s+out\b/i,
  /\bdenies?\b/i,
  /\brefuses?\b/i,
  /\bsnatches?\s+(?:it|them)\s+(?:away|back)\b/i,
  /\bpulls?\s+(?:it|them)\s+back\b/i,
  /\bcannot\s+reach\b/i,
  /\bcan'?t\s+reach\b/i,
  /\bnever\s+(?:had|got|reaches?)\b/i,
]

// Window sizes (chars around a noun match). Exact head-noun matches get a
// slightly wider window; synonym matches are stricter.
const EXACT_PROXIMITY = 90
const SYNONYM_PROXIMITY = 55

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

// Clean a captured object phrase: drop a trailing subordinate clause ("the
// pistol and aim it" -> "the pistol"), strip leading articles/possessives, trim
// punctuation, and bound the length.
function cleanObject(raw: string): string | null {
  let value = normalizeWhitespace(raw)
  // Cut at a conjunction / preposition / clause boundary so "the gun and run"
  // -> "the gun" and "a brass key without a word" -> "a brass key".
  value = value.split(
    /\b(?:and|then|before|after|to|so|but|while|as|without|with|from|into|onto|in|on|at|for|that|which|who|near|over|under|behind|beside)\b/i,
  )[0]
  value = value.replace(/^(?:the|a|an|my|his|her|their|its|new)\s+/i, '')
  value = value.replace(/[^a-zA-Z0-9'\- ]+$/g, '').trim()
  value = normalizeWhitespace(value)
  if (value.length < 2 || value.length > 48) return null
  // Reject phrases of more than 5 words — those are rarely a single object.
  const words = value.split(' ')
  if (words.length > 5) return null
  return value
}

function headNoun(objectName: string): string {
  const words = objectName.toLowerCase().split(' ')
  return words[words.length - 1] ?? ''
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function wordBoundaryIncludes(haystack: string, needle: string): boolean {
  if (!needle) return false
  return new RegExp(`\\b${escapeRegExp(needle)}\\b`, 'i').test(haystack)
}

/** Return the synonym class containing `term` (lowercased head), or null. */
function synonymClassFor(term: string): readonly string[] | null {
  const key = term.toLowerCase()
  for (const cls of OBJECT_SYNONYM_CLASSES) {
    if (cls.includes(key)) return cls
  }
  return null
}

/**
 * Prefer the player's face-name when minting: if the player said "sword" and
 * the narrator said "xiphos", mint as "sword" (detail may note the period form
 * elsewhere). Falls back to the cleaned player object when no class matches.
 */
function mintName(playerObject: string, acceptedNarratorForm: string | null): string {
  const playerHead = headNoun(playerObject)
  const cls = synonymClassFor(playerHead)
  if (cls) {
    // Canonical is first entry when the player used any class member.
    return cls[0]
  }
  // No class — keep player's phrase; if empty, fall back to narrator form.
  return playerObject || acceptedNarratorForm || playerObject
}

function windowAround(text: string, index: number, length: number, radius: number): string {
  const start = Math.max(0, index - radius)
  const end = Math.min(text.length, index + length + radius)
  return text.slice(start, end)
}

function hasMarkerIn(window: string, markers: RegExp[]): boolean {
  return markers.some((re) => re.test(window))
}

/**
 * Find a word-boundary occurrence of any candidate term in `narratorLower`
 * that sits near a possession marker (and not a denial marker).
 * Returns the matched term when accepted, else null.
 */
function findAcceptedForm(
  narratorLower: string,
  candidates: string[],
  proximity: number,
): string | null {
  for (const term of candidates) {
    if (!term || term.length < 3) continue
    const re = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi')
    let match: RegExpExecArray | null
    while ((match = re.exec(narratorLower)) !== null) {
      const win = windowAround(narratorLower, match.index, match[0].length, proximity)
      if (hasMarkerIn(win, DENIAL_MARKERS)) continue
      if (hasMarkerIn(win, POSSESSION_MARKERS)) return term
    }
  }
  return null
}

/**
 * Narrator acceptance for an acquired object: word-boundary match of the head
 * noun or a synonym class member, co-occurring with a possession-shaped verb
 * inside a proximity window. Exact matches use a wider window than synonyms.
 */
function narratorAcceptsAcquisition(
  object: string,
  narratorLower: string,
): { accepted: boolean; form: string | null } {
  const head = headNoun(object)
  if (head.length < 3 || NON_OBJECT_HEADS.has(head)) {
    return { accepted: false, form: null }
  }

  // Exact head first (wider window).
  const exact = findAcceptedForm(narratorLower, [head], EXACT_PROXIMITY)
  if (exact) return { accepted: true, form: exact }

  // Synonym class (stricter window). Also try full multi-word object.
  const cls = synonymClassFor(head)
  if (cls) {
    const others = cls.filter((t) => t !== head)
    const syn = findAcceptedForm(narratorLower, others, SYNONYM_PROXIMITY)
    if (syn) return { accepted: true, form: syn }
  }

  return { accepted: false, form: null }
}

// Returns the object name the player acquires this turn, or null.
// Single-object scope (accepted limitation): returns on the first match only —
// "I buy the sword and a shield" mints one item. Multi-object minting is deferred.
export function extractObjectAcquisition(
  playerText: string,
  narratorText: string,
): string | null {
  const narrator = narratorText.toLowerCase()
  // (pattern set, text to match) — active takes against the player's text;
  // passive receipts against the narration.
  const sources: Array<[RegExp[], string]> = [
    [ACTIVE_PATTERNS, playerText],
    [RECEIVE_PATTERNS, narratorText],
  ]
  for (const [patterns, text] of sources) {
    for (const pattern of patterns) {
      const match = text.match(pattern)
      if (!match?.[1]) continue
      const object = cleanObject(match[1])
      if (!object) continue
      const head = headNoun(object)
      if (head.length < 3 || NON_OBJECT_HEADS.has(head)) continue
      const { accepted, form } = narratorAcceptsAcquisition(object, narrator)
      if (!accepted) continue
      return mintName(object, form)
    }
  }
  return null
}

// The other half of possession movement: a player dropping/stashing an object
// (it leaves their hands and rests where they are) or handing one to a named
// character (it changes holder). Mirrors extractObjectAcquisition — pure regex
// over the player's text, with the same narrator-acceptance guard so an
// unhonoured move mints nothing. The *who actually holds it now* and *do they
// have it to give* decisions live in the patch-sanitizer pipeline.
export type ItemMovement =
  | { type: 'drop'; object: string }
  | { type: 'give'; object: string; recipient: string }

const DROP_PATTERNS: RegExp[] = [
  // "I drop / leave / stash / ditch / set down / put down / abandon [the|my|…]
  // <object>" — a trailing location clause ("on the floor") is stripped by
  // cleanObject; the placed location is the protagonist's current place, set by
  // the caller, not parsed here.
  /\b(?:i\s+)?(?:drop|drops|dropped|leave|leaves|left|stash|stashes|stashed|ditch|ditches|ditched|set\s+down|sets\s+down|put\s+down|puts\s+down|lay\s+down|abandon|abandons|abandoned)\s+(?:the\s+|a\s+|an\s+|my\s+|his\s+|her\s+|their\s+|its\s+)?([^.!?\n,;]{2,60})/i,
]

// "give / hand / pass / toss / offer / lend / return <the object> to <recipient>"
const GIVE_OBJECT_FIRST =
  /\b(?:i\s+)?(?:hand|hands|handed|give|gives|gave|pass|passes|passed|toss|tosses|tossed|offer|offers|offered|lend|lends|lent|return|returns|returned|deliver|delivers|delivered)\s+(?:over\s+|back\s+)?(?:the\s+|a\s+|an\s+|my\s+|his\s+|her\s+|their\s+|its\s+)([^.!?\n,;]{2,48}?)\s+to\s+([a-z][a-z'\-]+(?:\s+[a-z][a-z'\-]+)?)/i
// "give / hand / … <recipient> <the object>" (no "to") — recipient first.
const GIVE_RECIPIENT_FIRST =
  /\b(?:i\s+)?(?:hand|hands|handed|give|gives|gave|pass|passes|passed|toss|tosses|tossed|offer|offers|offered|lend|lends|lent|return|returns|returned|deliver|delivers|delivered)\s+([a-z][a-z'\-]+(?:\s+[a-z][a-z'\-]+)?)\s+(?:the\s+|a\s+|an\s+|my\s+|his\s+|her\s+|their\s+|its\s+)([^.!?\n,;]{2,48})/i

// First word of a recipient capture that means it is not actually a name (a
// preposition/pronoun that belongs to a different sentence shape).
const NON_RECIPIENT_HEADS = new Set([
  'over',
  'back',
  'out',
  'off',
  'up',
  'to',
  'it',
  'them',
  'him',
  'her',
  'me',
  'you',
  'us',
])

function cleanRecipient(raw: string): string | null {
  const value = normalizeWhitespace(raw).replace(/[^a-zA-Z'\- ]+$/g, '').trim()
  if (!value) return null
  const first = value.toLowerCase().split(' ')[0]
  if (NON_RECIPIENT_HEADS.has(first)) return null
  return value
}

// Narrator honoured this object move (word-boundary head noun in narration).
// Movements keep a simpler acceptance than acquisition: they already require
// the player to name a held object, and currency heads are rejected above.
function narratorHonours(object: string, narratorLower: string): boolean {
  const head = headNoun(object)
  if (head.length < 3 || NON_OBJECT_HEADS.has(head)) return false
  if (wordBoundaryIncludes(narratorLower, head)) return true
  // Allow synonym acceptance for moves too (drop "the blade" when ledger says sword).
  const cls = synonymClassFor(head)
  if (!cls) return false
  return cls.some((t) => t !== head && wordBoundaryIncludes(narratorLower, t))
}

export function extractItemMovements(
  playerText: string,
  narratorText: string,
): ItemMovement[] {
  const narrator = narratorText.toLowerCase()
  const movements: ItemMovement[] = []

  // Gives first — "I drop the key" and "I hand Torres the key" share verbs only
  // loosely, but a give is the more specific shape and should win when present.
  for (const pattern of [GIVE_OBJECT_FIRST, GIVE_RECIPIENT_FIRST]) {
    const match = playerText.match(pattern)
    if (!match) continue
    const objectFirst = pattern === GIVE_OBJECT_FIRST
    const object = cleanObject(objectFirst ? match[1] : match[2])
    const recipient = cleanRecipient(objectFirst ? match[2] : match[1])
    if (!object || !recipient) continue
    if (!narratorHonours(object, narrator)) continue
    movements.push({ type: 'give', object, recipient })
    break
  }

  if (movements.length === 0) {
    for (const pattern of DROP_PATTERNS) {
      const match = playerText.match(pattern)
      if (!match?.[1]) continue
      const object = cleanObject(match[1])
      if (!object) continue
      if (!narratorHonours(object, narrator)) continue
      movements.push({ type: 'drop', object })
      break
    }
  }

  return movements
}

/** Exported for tests / inventory resolution — synonym class of a head noun. */
export function objectSynonymClass(term: string): readonly string[] | null {
  return synonymClassFor(headNoun(term))
}
