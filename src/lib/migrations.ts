import type Database from 'better-sqlite3'

export type Migration = {
  version: number
  name: string
  up: (db: Database.Database) => void
}

// Snapshot of the pre-v4 hardcoded premise + initial state. Used by migration 4
// to backfill existing turns into a default world so we don't lose the running
// chat. Kept verbatim here; the live copy in src/lib/prompt.ts / src/lib/state.ts
// is removed as part of v0.3 and replaced by per-world rows.
const LEGACY_PREMISE = `
You are the narrator of a solo interactive novel set in a quiet Cornish fishing village
in the late 1890s. The protagonist is a young letter-writer who has just returned home
after seven years away in London. The harbour is preparing for a storm; rumours about a
wrecked schooner circulate in the pub. The tone is literary, restrained, sensory.
`.trim()

const LEGACY_INITIAL_STATE = {
  time: 'Late afternoon, autumn 1897',
  location: 'Mevagissey harbour, Cornwall — pubs and quay still in view',
  identity:
    'Young letter-writer, recently returned home after seven years in London. Travel-worn, carrying a single case. Name not yet established.',
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
  {
    // v0.3 — open the schema. Introduces a `worlds` table and scopes every
    // existing turn / turn_state to a world. SQLite can't add a NOT NULL FK
    // column in place, so we rebuild both tables with the standard
    // create-new + copy + drop + rename dance. runMigrations() disables
    // foreign_keys around the migration run so dropping `turns` while
    // `turn_states` still references it does not abort.
    version: 4,
    name: 'worlds',
    up: (db) => {
      db.exec(`
        CREATE TABLE worlds (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          name               TEXT    NOT NULL,
          premise            TEXT    NOT NULL,
          initial_state_json TEXT    NOT NULL,
          created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
        );
      `)

      const insertWorld = db.prepare<[string, string, string]>(
        'INSERT INTO worlds (name, premise, initial_state_json) VALUES (?, ?, ?) RETURNING id',
      )
      const defaultWorld = insertWorld.get(
        'Mevagissey 1897',
        LEGACY_PREMISE,
        JSON.stringify(LEGACY_INITIAL_STATE),
      ) as { id: number }
      const defaultWorldId = defaultWorld.id

      db.exec(`
        CREATE TABLE turns_new (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          world_id   INTEGER NOT NULL REFERENCES worlds(id),
          role       TEXT    NOT NULL CHECK (role IN ('user','assistant')),
          content    TEXT    NOT NULL,
          metadata   TEXT,
          created_at TEXT    NOT NULL DEFAULT (datetime('now'))
        );
      `)
      db.prepare(
        `INSERT INTO turns_new (id, world_id, role, content, metadata, created_at)
         SELECT id, ?, role, content, metadata, created_at FROM turns`,
      ).run(defaultWorldId)
      db.exec('DROP TABLE turns; ALTER TABLE turns_new RENAME TO turns;')

      db.exec(`
        CREATE TABLE turn_states_new (
          turn_id    INTEGER PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
          world_id   INTEGER NOT NULL REFERENCES worlds(id),
          state_json TEXT    NOT NULL,
          created_at TEXT    NOT NULL DEFAULT (datetime('now'))
        );
      `)
      db.prepare(
        `INSERT INTO turn_states_new (turn_id, world_id, state_json, created_at)
         SELECT turn_id, ?, state_json, created_at FROM turn_states`,
      ).run(defaultWorldId)
      db.exec('DROP TABLE turn_states; ALTER TABLE turn_states_new RENAME TO turn_states;')

      // ALTER TABLE ... RENAME leaves a stale entry in sqlite_sequence for the
      // pre-rename name. Reset turns' autoincrement counter to the actual MAX(id)
      // so the next inserted turn lands at the right place.
      db.exec("DELETE FROM sqlite_sequence WHERE name IN ('turns', 'turns_new');")
      db.exec(
        `INSERT INTO sqlite_sequence (name, seq)
         SELECT 'turns', COALESCE(MAX(id), 0) FROM turns`,
      )

      db.exec('CREATE INDEX turns_world_id_id ON turns(world_id, id);')
      db.exec('CREATE INDEX turn_states_world_id_turn_id ON turn_states(world_id, turn_id);')
    },
  },
]

export function runMigrations(db: Database.Database): void {
  const current = (db.pragma('user_version', { simple: true }) as number) ?? 0
  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version)
  if (pending.length === 0) return

  // SQLite refuses to change `foreign_keys` inside a transaction. We disable
  // them around the whole run so rebuild-style migrations (v4) can drop and
  // recreate tables that participate in FK relationships, then verify and
  // re-enable. Pragmas outside a transaction take effect immediately.
  db.pragma('foreign_keys = OFF')
  try {
    for (const m of pending) {
      const tx = db.transaction(() => {
        m.up(db)
        db.pragma(`user_version = ${m.version}`)
      })
      tx()
    }
    const violations = db.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) {
      throw new Error(`Foreign key violations after migration: ${JSON.stringify(violations)}`)
    }
  } finally {
    db.pragma('foreign_keys = ON')
  }
}
