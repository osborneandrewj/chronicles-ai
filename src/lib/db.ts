import Database from 'better-sqlite3'
import path from 'node:path'

export type TurnRole = 'user' | 'assistant'

export type Turn = {
  id: number
  role: TurnRole
  content: string
  state_json: string | null
  created_at: string
}

type Globals = typeof globalThis & { __chroniclesDb?: Database.Database }
const g = globalThis as Globals

function open(): Database.Database {
  const db = new Database(path.join(process.cwd(), 'chronicles.sqlite'))
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS turns (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      role       TEXT    NOT NULL CHECK (role IN ('user','assistant')),
      content    TEXT    NOT NULL,
      state_json TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)
  const cols = db.prepare("PRAGMA table_info('turns')").all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === 'state_json')) {
    db.exec('ALTER TABLE turns ADD COLUMN state_json TEXT')
  }
  return db
}

export const db: Database.Database = g.__chroniclesDb ?? (g.__chroniclesDb = open())

const insertStmt = db.prepare<[TurnRole, string]>(
  'INSERT INTO turns (role, content) VALUES (?, ?) RETURNING id, role, content, state_json, created_at',
)
const allStmt = db.prepare(
  'SELECT id, role, content, state_json, created_at FROM turns ORDER BY id ASC',
)
const recentStmt = db.prepare(
  'SELECT id, role, content FROM turns ORDER BY id DESC LIMIT ?',
)
const latestStateStmt = db.prepare(
  "SELECT state_json FROM turns WHERE state_json IS NOT NULL ORDER BY id DESC LIMIT 1",
)
const updateStateStmt = db.prepare<[string, number]>(
  'UPDATE turns SET state_json = ? WHERE id = ?',
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

export function getLatestStateJson(): string | null {
  const row = latestStateStmt.get() as { state_json: string | null } | undefined
  return row?.state_json ?? null
}

export function updateTurnState(id: number, stateJson: string): void {
  updateStateStmt.run(stateJson, id)
}
