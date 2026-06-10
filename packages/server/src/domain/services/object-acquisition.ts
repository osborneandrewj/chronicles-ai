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
