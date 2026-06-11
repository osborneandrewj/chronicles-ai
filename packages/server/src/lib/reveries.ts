import type { ReverieInput, ReverieRow } from '@/domain/entities'
import {
  MAX_REVERIES_PER_NPC,
  clampIntensity,
  decayedIntensity,
  normalizeReverieTag,
  normalizeReverieText,
} from '@/domain/services/reverie-flare'
import { db } from '@/lib/db'

// The pure reverie-flare core (canMintReverie / computeReverieFlares / the
// normalizers + constants) moved to domain/services/reverie-flare.ts (P4).
// Re-exported here for back-compat with existing `@/lib/reveries` importers; the
// CRUD/I/O below stays until repositories land (P5).
export type { FlareCandidate, ReverieInput, ReverieRow } from '@/domain/entities'
export {
  MAX_REVERIES_PER_NPC,
  REVERIE_COOLDOWN_TURNS,
  REVERIE_FLARE_COOLDOWN_TURN_IDS,
  REVERIE_FLARE_DECAY,
  REVERIE_INTENSITY_FLOOR,
  canMintReverie,
  computeReverieFlares,
  decayedIntensity,
  normalizeReverieTag,
  normalizeReverieText,
} from '@/domain/services/reverie-flare'

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
const stampFlaredStmt = db.prepare<[number, number, number]>(
  'UPDATE npc_reveries SET last_flared_turn_id = ?, intensity = ? WHERE id = ?',
)
const repointReverieStmt = db.prepare<[number, number]>(
  'UPDATE npc_reveries SET character_id = ? WHERE id = ?',
)
// MAX(created_turn_id) is the NPC's last *minted* turn because turns.id is
// autoincrement (monotone) — the newest reverie has the highest created_turn_id.
// NULL (no minted rows, or backfilled rows with NULL) is handled by the caller.
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

const reverieIntensityStmt = db.prepare<[number]>(
  'SELECT intensity FROM npc_reveries WHERE id = ?',
)

// Stamp the flare turn AND decay the reverie's intensity toward the floor, so a
// motif that keeps matching the standing scene gradually loses its slot (Phase A
// anti-repetition). Best-effort; a missing row is skipped.
export function stampFlaredReveries(reverieIds: number[], turnId: number): void {
  if (reverieIds.length === 0) return
  const tx = db.transaction(() => {
    for (const id of reverieIds) {
      const row = reverieIntensityStmt.get(id) as { intensity: number } | undefined
      if (!row) continue
      stampFlaredStmt.run(turnId, decayedIntensity(row.intensity), id)
    }
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
