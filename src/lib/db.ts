import Database from 'better-sqlite3'
import path from 'node:path'

import { runMigrations } from '@/lib/migrations'
import type { Character, Place, Scene } from '@/lib/world-state'

export type TurnRole = 'user' | 'assistant'

export type Turn = {
  id: number
  world_id: number
  role: TurnRole
  content: string
  scene_id: number | null
  created_at: string
}

type Globals = typeof globalThis & { __chroniclesDb?: Database.Database }
const g = globalThis as Globals

function open(): Database.Database {
  // Next.js's "collect page data" build phase imports every page, which
  // transitively opens this DB. On a mounted volume that produces SQLITE_BUSY
  // when build workers race for the lock. Build workers get an in-memory DB
  // (fresh per worker, no file, no locking); only runtime touches the real file.
  // DATABASE_PATH points at the mounted volume in prod (Railway). Dev falls
  // back to cwd/chronicles.sqlite so local workflows are unchanged.
  const isBuild = process.env.NEXT_PHASE === 'phase-production-build'
  const dbPath = isBuild
    ? ':memory:'
    : (process.env.DATABASE_PATH ?? path.join(process.cwd(), 'chronicles.sqlite'))
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

export const db: Database.Database = g.__chroniclesDb ?? (g.__chroniclesDb = open())

const insertStmt = db.prepare<[number, TurnRole, string, number | null]>(
  `INSERT INTO turns (world_id, role, content, scene_id)
   VALUES (?, ?, ?, ?)
   RETURNING id, world_id, role, content, scene_id, created_at`,
)
const allStmt = db.prepare<[number]>(
  `SELECT id, world_id, role, content, scene_id, created_at
   FROM turns WHERE world_id = ? ORDER BY id ASC`,
)
const recentStmt = db.prepare<[number, number]>(
  `SELECT id, role, content FROM turns
   WHERE world_id = ? ORDER BY id DESC LIMIT ?`,
)
const latestUserContentStmt = db.prepare<[number]>(
  `SELECT content FROM turns
   WHERE world_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1`,
)
// json_patch merges the supplied object into existing metadata so concurrent
// writers (archivist, tts char recorder) don't clobber each other's keys.
const updateMetadataStmt = db.prepare<[string, number]>(
  `UPDATE turns SET metadata = json_patch(COALESCE(metadata, '{}'), ?) WHERE id = ?`,
)
// Additive: sums into the existing $.tts.chars rather than overwriting it, so
// replaying an old turn N times grows that turn's recorded char count by the
// total replayed instead of clobbering the original stream's value. The
// world_id + role guard prevents a request for world A from crediting a turn
// that actually belongs to world B (or to a 'user' turn within world A).
const addTtsCharsStmt = db.prepare<[number, number, number]>(
  `UPDATE turns
   SET metadata = json_set(
     COALESCE(metadata, '{}'),
     '$.tts.chars',
     COALESCE(json_extract(metadata, '$.tts.chars'), 0) + ?
   )
   WHERE id = ? AND world_id = ? AND role = 'assistant'`,
)
// Includes both the old `extractor` key (pre-v0.5) and the new `archivist` key
// in the sum so cost totals stay continuous across the v5 cutover.
const usageTotalsStmt = db.prepare<[number]>(`
  SELECT
    COUNT(metadata)                                              AS turns,
    COALESCE(SUM(json_extract(metadata, '$.narrator.usage.inputTokens')),  0) AS narratorInput,
    COALESCE(SUM(json_extract(metadata, '$.narrator.usage.outputTokens')), 0) AS narratorOutput,
    COALESCE(SUM(json_extract(metadata, '$.archivist.usage.inputTokens')),  0)
      + COALESCE(SUM(json_extract(metadata, '$.extractor.usage.inputTokens')),  0) AS archivistInput,
    COALESCE(SUM(json_extract(metadata, '$.archivist.usage.outputTokens')), 0)
      + COALESCE(SUM(json_extract(metadata, '$.extractor.usage.outputTokens')), 0) AS archivistOutput
  FROM turns
  WHERE world_id = ? AND metadata IS NOT NULL
`)

// World-state readers (v0.5). Typed entity rows replace the legacy turn_states blob.
const charactersForWorldStmt = db.prepare<[number]>(
  `SELECT id, world_id, name, description, is_player, current_place_id,
          memorable_facts, status
   FROM characters WHERE world_id = ? ORDER BY is_player DESC, id ASC`,
)
const charactersInPlaceStmt = db.prepare<[number, number]>(
  `SELECT id, world_id, name, description, is_player, current_place_id,
          memorable_facts, status
   FROM characters WHERE world_id = ? AND current_place_id = ? ORDER BY id ASC`,
)
const placesForWorldStmt = db.prepare<[number]>(
  `SELECT id, world_id, name, description, kind FROM places
   WHERE world_id = ? ORDER BY id ASC`,
)
const placeByIdStmt = db.prepare<[number]>(
  'SELECT id, world_id, name, description, kind FROM places WHERE id = ?',
)
const scenesForWorldStmt = db.prepare<[number]>(
  `SELECT id, world_id, place_id, title, summary, scene_number, status,
          opened_at_turn, closed_at_turn
   FROM scenes WHERE world_id = ? ORDER BY scene_number ASC`,
)
const activeSceneStmt = db.prepare<[number]>(
  `SELECT id, world_id, place_id, title, summary, scene_number, status,
          opened_at_turn, closed_at_turn
   FROM scenes WHERE world_id = ? AND status = 'active'
   ORDER BY scene_number DESC LIMIT 1`,
)
const worldCursorStmt = db.prepare<[number]>(
  'SELECT world_time, current_scene_id FROM worlds WHERE id = ?',
)
const latestMetadataStmt = db.prepare<[number]>(
  `SELECT id, metadata FROM turns
   WHERE world_id = ? AND metadata IS NOT NULL ORDER BY id DESC LIMIT 1`,
)
const assistantMetadataStmt = db.prepare<[number]>(
  `SELECT id, metadata FROM turns
   WHERE world_id = ? AND role = 'assistant' AND metadata IS NOT NULL ORDER BY id ASC`,
)

export function insertTurn(
  worldId: number,
  role: TurnRole,
  content: string,
  sceneId: number | null = null,
): Turn {
  return insertStmt.get(worldId, role, content, sceneId) as Turn
}

export function allTurns(worldId: number): Turn[] {
  return allStmt.all(worldId) as Turn[]
}

export function recentTurns(
  worldId: number,
  limit: number,
): Array<Pick<Turn, 'id' | 'role' | 'content'>> {
  const rows = recentStmt.all(worldId, limit) as Array<Pick<Turn, 'id' | 'role' | 'content'>>
  return rows.reverse()
}

export function latestUserContent(worldId: number): string | null {
  const row = latestUserContentStmt.get(worldId) as { content: string } | undefined
  return row?.content ?? null
}

export function getCharactersForWorld(worldId: number): Character[] {
  return charactersForWorldStmt.all(worldId) as Character[]
}

export function getCharactersInPlace(worldId: number, placeId: number): Character[] {
  return charactersInPlaceStmt.all(worldId, placeId) as Character[]
}

export function getPlacesForWorld(worldId: number): Place[] {
  return placesForWorldStmt.all(worldId) as Place[]
}

export function getPlace(id: number): Place | null {
  return (placeByIdStmt.get(id) as Place | undefined) ?? null
}

export function getScenesForWorld(worldId: number): Scene[] {
  return scenesForWorldStmt.all(worldId) as Scene[]
}

export function getActiveSceneForWorld(worldId: number): Scene | null {
  return (activeSceneStmt.get(worldId) as Scene | undefined) ?? null
}

export type WorldCursor = { world_time: string | null; current_scene_id: number | null }

export function getWorldCursor(worldId: number): WorldCursor {
  const row = worldCursorStmt.get(worldId) as WorldCursor | undefined
  return row ?? { world_time: null, current_scene_id: null }
}

export function updateTurnMetadata(id: number, metadata: Record<string, unknown>): void {
  updateMetadataStmt.run(JSON.stringify(metadata), id)
}

export function addTtsChars(worldId: number, turnId: number, chars: number): void {
  addTtsCharsStmt.run(Math.max(0, Math.round(chars)), turnId, worldId)
}

export type UsageTotals = {
  turns: number
  narratorInput: number
  narratorOutput: number
  archivistInput: number
  archivistOutput: number
}

export function getUsageTotals(worldId: number): UsageTotals {
  return usageTotalsStmt.get(worldId) as UsageTotals
}

export function getLatestMetadata(
  worldId: number,
): { id: number; metadata: Record<string, unknown> } | null {
  const row = latestMetadataStmt.get(worldId) as { id: number; metadata: string } | undefined
  if (!row) return null
  try {
    return { id: row.id, metadata: JSON.parse(row.metadata) as Record<string, unknown> }
  } catch {
    return null
  }
}

export type AssistantTurnMetadata = { id: number; metadata: Record<string, unknown> }

export function allAssistantMetadata(worldId: number): AssistantTurnMetadata[] {
  const rows = assistantMetadataStmt.all(worldId) as Array<{ id: number; metadata: string }>
  return rows.flatMap((row) => {
    try {
      return [{ id: row.id, metadata: JSON.parse(row.metadata) as Record<string, unknown> }]
    } catch {
      return []
    }
  })
}
