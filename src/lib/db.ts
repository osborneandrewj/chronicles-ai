import Database from 'better-sqlite3'
import path from 'node:path'

import { runMigrations } from '@/lib/migrations'

export type TurnRole = 'user' | 'assistant'

export type Turn = {
  id: number
  world_id: number
  role: TurnRole
  content: string
  created_at: string
}

type Globals = typeof globalThis & { __chroniclesDb?: Database.Database }
const g = globalThis as Globals

function open(): Database.Database {
  // DATABASE_PATH points at the mounted volume in prod (Railway). Dev falls
  // back to cwd/chronicles.sqlite so local workflows are unchanged.
  const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'chronicles.sqlite')
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

export const db: Database.Database = g.__chroniclesDb ?? (g.__chroniclesDb = open())

const insertStmt = db.prepare<[number, TurnRole, string]>(
  `INSERT INTO turns (world_id, role, content)
   VALUES (?, ?, ?)
   RETURNING id, world_id, role, content, created_at`,
)
const allStmt = db.prepare<[number]>(
  `SELECT id, world_id, role, content, created_at
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
const latestStateStmt = db.prepare<[number]>(
  `SELECT state_json FROM turn_states
   WHERE world_id = ? ORDER BY turn_id DESC LIMIT 1`,
)
const upsertStateStmt = db.prepare<[number, number, string]>(
  `INSERT INTO turn_states (turn_id, world_id, state_json) VALUES (?, ?, ?)
   ON CONFLICT(turn_id) DO UPDATE SET state_json = excluded.state_json`,
)
// json_patch merges the supplied object into existing metadata so concurrent
// writers (extractor, tts char recorder) don't clobber each other's keys.
const updateMetadataStmt = db.prepare<[string, number]>(
  `UPDATE turns SET metadata = json_patch(COALESCE(metadata, '{}'), ?) WHERE id = ?`,
)
const updateLatestAssistantTtsCharsStmt = db.prepare<[number, number]>(
  `UPDATE turns
   SET metadata = json_set(COALESCE(metadata, '{}'), '$.tts.chars', ?)
   WHERE id = (
     SELECT id FROM turns
     WHERE world_id = ? AND role = 'assistant'
     ORDER BY id DESC LIMIT 1
   )`,
)
const usageTotalsStmt = db.prepare<[number]>(`
  SELECT
    COUNT(metadata)                                              AS turns,
    COALESCE(SUM(json_extract(metadata, '$.narrator.usage.inputTokens')),  0) AS narratorInput,
    COALESCE(SUM(json_extract(metadata, '$.narrator.usage.outputTokens')), 0) AS narratorOutput,
    COALESCE(SUM(json_extract(metadata, '$.extractor.usage.inputTokens')),  0) AS extractorInput,
    COALESCE(SUM(json_extract(metadata, '$.extractor.usage.outputTokens')), 0) AS extractorOutput
  FROM turns
  WHERE world_id = ? AND metadata IS NOT NULL
`)
const latestMetadataStmt = db.prepare<[number]>(
  `SELECT id, metadata FROM turns
   WHERE world_id = ? AND metadata IS NOT NULL ORDER BY id DESC LIMIT 1`,
)
const assistantMetadataStmt = db.prepare<[number]>(
  `SELECT id, metadata FROM turns
   WHERE world_id = ? AND role = 'assistant' AND metadata IS NOT NULL ORDER BY id ASC`,
)

export function insertTurn(worldId: number, role: TurnRole, content: string): Turn {
  return insertStmt.get(worldId, role, content) as Turn
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

export function getLatestStateJson(worldId: number): string | null {
  const row = latestStateStmt.get(worldId) as { state_json: string | null } | undefined
  return row?.state_json ?? null
}

export function updateTurnState(turnId: number, worldId: number, stateJson: string): void {
  upsertStateStmt.run(turnId, worldId, stateJson)
}

export function updateTurnMetadata(id: number, metadata: Record<string, unknown>): void {
  updateMetadataStmt.run(JSON.stringify(metadata), id)
}

export function recordLatestAssistantTtsChars(worldId: number, chars: number): void {
  updateLatestAssistantTtsCharsStmt.run(Math.max(0, Math.round(chars)), worldId)
}

export type UsageTotals = {
  turns: number
  narratorInput: number
  narratorOutput: number
  extractorInput: number
  extractorOutput: number
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
