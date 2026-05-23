import type Database from 'better-sqlite3'

export type Migration = {
  version: number
  name: string
  up: (db: Database.Database) => void
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_turns',
    up: (db) => {
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
    },
  },
  {
    version: 2,
    name: 'split_turn_states',
    up: (db) => {
      db.exec(`
        CREATE TABLE turn_states (
          turn_id    INTEGER PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
          state_json TEXT    NOT NULL,
          created_at TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO turn_states (turn_id, state_json, created_at)
          SELECT id, state_json, created_at FROM turns WHERE state_json IS NOT NULL;
        ALTER TABLE turns DROP COLUMN state_json;
      `)
    },
  },
  {
    version: 3,
    name: 'turn_metadata',
    up: (db) => {
      db.exec('ALTER TABLE turns ADD COLUMN metadata TEXT')
    },
  },
]

export function runMigrations(db: Database.Database): void {
  const current = (db.pragma('user_version', { simple: true }) as number) ?? 0
  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version)
  for (const m of pending) {
    const tx = db.transaction(() => {
      m.up(db)
      db.pragma(`user_version = ${m.version}`)
    })
    tx()
  }
}
