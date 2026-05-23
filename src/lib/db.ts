import Database from 'better-sqlite3'
import path from 'node:path'

import { runMigrations } from '@/lib/migrations'

export type TurnRole = 'user' | 'assistant'

export type Turn = {
  id: number
  role: TurnRole
  content: string
  created_at: string
}

type Globals = typeof globalThis & { __chroniclesDb?: Database.Database }
const g = globalThis as Globals

function open(): Database.Database {
  const db = new Database(path.join(process.cwd(), 'chronicles.sqlite'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

export const db: Database.Database = g.__chroniclesDb ?? (g.__chroniclesDb = open())

const insertStmt = db.prepare<[TurnRole, string]>(
  'INSERT INTO turns (role, content) VALUES (?, ?) RETURNING id, role, content, created_at',
)
const allStmt = db.prepare(
  'SELECT id, role, content, created_at FROM turns ORDER BY id ASC',
)
const recentStmt = db.prepare(
  'SELECT id, role, content FROM turns ORDER BY id DESC LIMIT ?',
)
const latestUserContentStmt = db.prepare(
  "SELECT content FROM turns WHERE role = 'user' ORDER BY id DESC LIMIT 1",
)
const latestStateStmt = db.prepare(
  'SELECT state_json FROM turn_states ORDER BY turn_id DESC LIMIT 1',
)
const upsertStateStmt = db.prepare<[number, string]>(
  `INSERT INTO turn_states (turn_id, state_json) VALUES (?, ?)
   ON CONFLICT(turn_id) DO UPDATE SET state_json = excluded.state_json`,
)
const updateMetadataStmt = db.prepare<[string, number]>(
  'UPDATE turns SET metadata = ? WHERE id = ?',
)
const usageTotalsStmt = db.prepare(`
  SELECT
    COUNT(metadata)                                              AS turns,
    COALESCE(SUM(json_extract(metadata, '$.narrator.usage.inputTokens')),  0) AS narratorInput,
    COALESCE(SUM(json_extract(metadata, '$.narrator.usage.outputTokens')), 0) AS narratorOutput,
    COALESCE(SUM(json_extract(metadata, '$.extractor.usage.inputTokens')),  0) AS extractorInput,
    COALESCE(SUM(json_extract(metadata, '$.extractor.usage.outputTokens')), 0) AS extractorOutput
  FROM turns
  WHERE metadata IS NOT NULL
`)
const latestMetadataStmt = db.prepare(
  'SELECT id, metadata FROM turns WHERE metadata IS NOT NULL ORDER BY id DESC LIMIT 1',
)
const assistantMetadataStmt = db.prepare(
  "SELECT id, metadata FROM turns WHERE role = 'assistant' AND metadata IS NOT NULL ORDER BY id ASC",
)

export function insertTurn(role: TurnRole, content: string): Turn {
  return insertStmt.get(role, content) as Turn
}

export function allTurns(): Turn[] {
  return allStmt.all() as Turn[]
}

export function recentTurns(limit: number): Array<Pick<Turn, 'id' | 'role' | 'content'>> {
  const rows = recentStmt.all(limit) as Array<Pick<Turn, 'id' | 'role' | 'content'>>
  return rows.reverse()
}

export function latestUserContent(): string | null {
  const row = latestUserContentStmt.get() as { content: string } | undefined
  return row?.content ?? null
}

export function getLatestStateJson(): string | null {
  const row = latestStateStmt.get() as { state_json: string | null } | undefined
  return row?.state_json ?? null
}

export function updateTurnState(id: number, stateJson: string): void {
  upsertStateStmt.run(id, stateJson)
}

export function updateTurnMetadata(id: number, metadata: Record<string, unknown>): void {
  updateMetadataStmt.run(JSON.stringify(metadata), id)
}

export type UsageTotals = {
  turns: number
  narratorInput: number
  narratorOutput: number
  extractorInput: number
  extractorOutput: number
}

export function getUsageTotals(): UsageTotals {
  return usageTotalsStmt.get() as UsageTotals
}

export function getLatestMetadata(): { id: number; metadata: Record<string, unknown> } | null {
  const row = latestMetadataStmt.get() as { id: number; metadata: string } | undefined
  if (!row) return null
  try {
    return { id: row.id, metadata: JSON.parse(row.metadata) as Record<string, unknown> }
  } catch {
    return null
  }
}

export type AssistantTurnMetadata = { id: number; metadata: Record<string, unknown> }

export function allAssistantMetadata(): AssistantTurnMetadata[] {
  const rows = assistantMetadataStmt.all() as Array<{ id: number; metadata: string }>
  return rows.flatMap((row) => {
    try {
      return [{ id: row.id, metadata: JSON.parse(row.metadata) as Record<string, unknown> }]
    } catch {
      return []
    }
  })
}
