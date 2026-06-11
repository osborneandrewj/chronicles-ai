// Pure domain service (Phase A, A4) — deterministic object-acquisition
// extraction. Mirrors `extractDestination` in patch-sanitizer: a player whose
// text clearly takes, pockets, grabs, or is handed an object should have that
// object promoted into the tracked-object ledger held_by the protagonist —
// WITHOUT depending on the archivist LLM opting in. The playthrough showed
// objects (photograph, ring, data pad, chainsword, bolt pistol) living only in
// prose memorable_facts, which let stale "NPC possesses X" facts override the
// player taking them. This closes that gap deterministically.
//
// No I/O — given the player's text and the narrator's response, returns the
// object name to promote (or null). The narrator-acceptance check (the object's
// head noun must appear in the narration) keeps a blocked or imagined grab from
// minting a phantom resource.

// Active takes are matched against the PLAYER's text only — the player is the
// implicit "I" subject, so an NPC grabbing something in the narration is not
// mis-attributed to the protagonist.
const ACTIVE_PATTERNS: RegExp[] = [
  // "I take / grab / pick up / pocket / snatch / seize / lift / swipe / collect
  // / retrieve [the|a|my|his|her|their] <object>"
  /\b(?:i\s+)?(?:take|grab|pick\s+up|pocket|snatch|seize|lift|swipe|collect|retrieve|pluck)\s+(?:the\s+|a\s+|an\s+|my\s+|his\s+|her\s+|their\s+|its\s+)?([^.!?\n,;]{2,60})/i,
]

// Passive receipts are matched against the NARRATOR's text — being handed an
// object is described in narration. The `(?:me|you)` requirement keeps a
// handover to someone else ("hands Torres the key") from matching.
const RECEIVE_PATTERNS: RegExp[] = [
  /\b(?:hand(?:s|ed)?|give(?:s)?|gave|pass(?:es|ed)?|toss(?:es|ed)?|offer(?:s|ed)?)\s+(?:me|you)\s+(?:the\s+|a\s+|an\s+)?([^.!?\n,;]{2,60})/i,
]

// Words that are not really objects — guard against "I take a look", "I take a
// breath", "I take cover", "I grab her hand", etc.
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
  'cover',
])

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
  value = value.replace(/^(?:the|a|an|my|his|her|their|its)\s+/i, '')
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

// Returns the object name the player acquires this turn, or null. The object's
// head noun must also appear in the narrator's response (acceptance), so a
// grab the narrator did not honour does not mint a phantom resource.
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
      if (!narrator.includes(head)) continue
      return object
    }
  }
  return null
}

// The other half of possession movement: a player dropping/stashing an object
// (it leaves their hands and rests where they are) or handing one to a named
// character (it changes holder). Mirrors extractObjectAcquisition — pure regex
// over the player's text, with the same narrator-acceptance guard (the object's
// head noun must appear in the narration) so an unhonoured move mints nothing.
// The *who actually holds it now* and *do they have it to give* decisions live
// in the patch-sanitizer pipeline (it has prior state); this only parses intent.
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

// Narrator honoured this object move (its head noun shows up in the narration).
function narratorHonours(object: string, narratorLower: string): boolean {
  const head = headNoun(object)
  if (head.length < 3 || NON_OBJECT_HEADS.has(head)) return false
  return narratorLower.includes(head)
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
