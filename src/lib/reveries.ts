import { db } from '@/lib/db'

export const MAX_REVERIES_PER_NPC = 3

// v0.6.x: how many of this world's player turns must pass between an NPC
// minting one reverie and the next. Deterministic rate throttle; the agent
// prompt's "rarely" is only a nudge. Tunable.
export const REVERIE_COOLDOWN_TURNS = 15

// Pure decision: may this NPC mint a new reverie this tick? The first one (no
// reveries yet) is always free; afterwards a full cooldown must have elapsed.
export function canMintReverie(
  state: { hasAny: boolean; playerTurnsSinceLast: number },
  cooldown = REVERIE_COOLDOWN_TURNS,
): boolean {
  return !state.hasAny || state.playerTurnsSinceLast >= cooldown
}

export type ReverieRow = {
  id: number
  world_id: number
  character_id: number
  text: string
  match_tags: string[]
  intensity: number
  is_cornerstone: number
  created_turn_id: number | null
  last_flared_turn_id: number | null
  created_at: string
}

export type ReverieInput = {
  text: string
  match_tags?: string[]
  intensity?: number
}

export type FlareCandidate = {
  id: number
  character_id: number
  match_tags: string[]
  intensity: number
}

export function normalizeReverieTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function normalizeReverieText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

// Pure. Per NPC, the single highest-scoring reverie with >=1 tag overlap is a
// candidate (score = overlapCount * intensity). Present NPCs are guaranteed a
// slot; the remainder fill by score until perTurnCap. Deterministic tie-breaks
// keep output stable across runs.
export function computeReverieFlares(
  candidates: FlareCandidate[],
  sceneTags: string[],
  opts: { perTurnCap?: number; presentCharacterIds?: number[] },
): number[] {
  const perTurnCap = opts.perTurnCap ?? 2
  const present = new Set(opts.presentCharacterIds ?? [])
  const sceneSet = new Set(sceneTags.map(normalizeReverieTag))

  type Scored = { id: number; character_id: number; score: number; intensity: number }
  const winnerByChar = new Map<number, Scored>()
  for (const c of candidates) {
    const overlap = c.match_tags.reduce(
      (n, t) => (sceneSet.has(normalizeReverieTag(t)) ? n + 1 : n),
      0,
    )
    if (overlap === 0) continue
    const scored: Scored = {
      id: c.id,
      character_id: c.character_id,
      score: overlap * c.intensity,
      intensity: c.intensity,
    }
    const prev = winnerByChar.get(c.character_id)
    if (
      !prev ||
      scored.score > prev.score ||
      (scored.score === prev.score && scored.intensity > prev.intensity) ||
      (scored.score === prev.score && scored.intensity === prev.intensity && scored.id < prev.id)
    ) {
      winnerByChar.set(c.character_id, scored)
    }
  }

  const winners = [...winnerByChar.values()].sort((a, b) => {
    const aPresent = present.has(a.character_id) ? 1 : 0
    const bPresent = present.has(b.character_id) ? 1 : 0
    if (aPresent !== bPresent) return bPresent - aPresent
    if (b.score !== a.score) return b.score - a.score
    return a.id - b.id
  })

  return winners.slice(0, perTurnCap).map((w) => w.id)
}

// ---- DB access -------------------------------------------------------------

const insertReverieStmt = db.prepare<[number, number, string, string, number, number | null]>(
  `INSERT INTO npc_reveries (world_id, character_id, text, match_tags, intensity, created_turn_id)
   VALUES (?, ?, ?, ?, ?, ?)`,
)
const reveriesForCharacterStmt = db.prepare<[number]>(
  'SELECT * FROM npc_reveries WHERE character_id = ? ORDER BY id ASC',
)
const reveriesForWorldStmt = db.prepare<[number]>(
  'SELECT * FROM npc_reveries WHERE world_id = ? ORDER BY character_id ASC, id ASC',
)
const deleteReverieStmt = db.prepare<[number]>('DELETE FROM npc_reveries WHERE id = ?')
const stampFlaredStmt = db.prepare<[number, number]>(
  'UPDATE npc_reveries SET last_flared_turn_id = ? WHERE id = ?',
)
const repointReverieStmt = db.prepare<[number, number]>(
  'UPDATE npc_reveries SET character_id = ? WHERE id = ?',
)
const reverieMintInfoStmt = db.prepare<[number]>(
  'SELECT MAX(created_turn_id) AS lastTurn, COUNT(*) AS n FROM npc_reveries WHERE character_id = ?',
)
const playerTurnsSinceStmt = db.prepare<[number, number]>(
  "SELECT COUNT(*) AS n FROM turns WHERE world_id = ? AND role = 'user' AND id > ?",
)

type RawReverieRow = Omit<ReverieRow, 'match_tags'> & { match_tags: string }

function hydrate(row: RawReverieRow): ReverieRow {
  return {
    ...row,
    match_tags: row.match_tags
      ? row.match_tags.split(',').map((t) => t.trim()).filter((t) => t.length > 0)
      : [],
  }
}

export function getReveriesForCharacter(characterId: number): ReverieRow[] {
  return (reveriesForCharacterStmt.all(characterId) as RawReverieRow[]).map(hydrate)
}

export function getReveriesForCharacters(characterIds: number[]): Map<number, ReverieRow[]> {
  const out = new Map<number, ReverieRow[]>()
  for (const id of characterIds) out.set(id, getReveriesForCharacter(id))
  return out
}

export function getReveriesForWorld(worldId: number): ReverieRow[] {
  return (reveriesForWorldStmt.all(worldId) as RawReverieRow[]).map(hydrate)
}

export function stampFlaredReveries(reverieIds: number[], turnId: number): void {
  if (reverieIds.length === 0) return
  const tx = db.transaction(() => {
    for (const id of reverieIds) stampFlaredStmt.run(turnId, id)
  })
  tx()
}

// Keep the strongest, then most-recently-flared, then newest. Evict the rest.
function pruneReveriesForCharacter(characterId: number, max = MAX_REVERIES_PER_NPC): void {
  const rows = getReveriesForCharacter(characterId)
  if (rows.length <= max) return
  const ranked = [...rows].sort((a, b) => {
    if (b.intensity !== a.intensity) return b.intensity - a.intensity
    const af = a.last_flared_turn_id ?? -1
    const bf = b.last_flared_turn_id ?? -1
    if (bf !== af) return bf - af
    return b.id - a.id
  })
  for (const row of ranked.slice(max)) deleteReverieStmt.run(row.id)
}

// Inputs for canMintReverie. playerTurnsSinceLast is the number of this world's
// player turns inserted after the NPC's most recent minted reverie; Infinity
// when the NPC has no reverie carrying a created_turn_id (none, or only
// backfilled rows) so the cooldown does not block the next mint.
export function reverieMintState(
  worldId: number,
  characterId: number,
): { hasAny: boolean; playerTurnsSinceLast: number } {
  const info = reverieMintInfoStmt.get(characterId) as { lastTurn: number | null; n: number }
  const hasAny = info.n > 0
  if (info.lastTurn === null) {
    return { hasAny, playerTurnsSinceLast: Number.POSITIVE_INFINITY }
  }
  const since = playerTurnsSinceStmt.get(worldId, info.lastTurn) as { n: number }
  return { hasAny, playerTurnsSinceLast: since.n }
}

export function addReveriesForCharacter(
  worldId: number,
  characterId: number,
  inputs: ReverieInput[],
  createdTurnId: number | null,
): void {
  if (inputs.length === 0) return
  const tx = db.transaction(() => {
    const seen = new Set(
      getReveriesForCharacter(characterId).map((r) => normalizeReverieText(r.text)),
    )
    for (const input of inputs) {
      const text = input.text.trim()
      if (text.length === 0) continue
      const norm = normalizeReverieText(text)
      if (seen.has(norm)) continue
      seen.add(norm)
      const tags = (input.match_tags ?? []).map(normalizeReverieTag).filter((t) => t.length > 0)
      const intensity = clampIntensity(input.intensity)
      insertReverieStmt.run(worldId, characterId, text, tags.join(','), intensity, createdTurnId)
    }
    pruneReveriesForCharacter(characterId)
  })
  tx()
}

export function repointReveries(sourceCharacterId: number, targetCharacterId: number): void {
  const tx = db.transaction(() => {
    const seen = new Set(
      getReveriesForCharacter(targetCharacterId).map((r) => normalizeReverieText(r.text)),
    )
    for (const row of getReveriesForCharacter(sourceCharacterId)) {
      if (seen.has(normalizeReverieText(row.text))) {
        deleteReverieStmt.run(row.id)
      } else {
        seen.add(normalizeReverieText(row.text))
        repointReverieStmt.run(targetCharacterId, row.id)
      }
    }
    pruneReveriesForCharacter(targetCharacterId)
  })
  tx()
}

function clampIntensity(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.5
  return Math.min(1, Math.max(0, value))
}
