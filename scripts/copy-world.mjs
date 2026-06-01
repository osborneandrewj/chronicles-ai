#!/usr/bin/env node
// Copy a single world (with its full play history) from one chronicles SQLite
// DB into another, as a NEW world. All primary keys are re-assigned by the
// target and every foreign key is remapped, so the world can land in a DB that
// already has unrelated worlds without collision.
//
// The world subgraph has circular FKs (worlds.current_scene_id -> scenes,
// scenes.opened_at_turn -> turns, turns.scene_id -> scenes), so the import runs
// with foreign_keys OFF, inserts every row first (capturing old->new id maps),
// then rewrites all FK columns in a second pass, then runs foreign_key_check
// before committing. The FK graph and column lists are introspected from the
// target schema, so this stays correct across migrations.
//
// Usage:
//   Export:  node scripts/copy-world.mjs export --source-id 10 --out world10.json [--db ./chronicles.sqlite]
//   Import:  node scripts/copy-world.mjs import --in world10.json [--name "New Name"] [--db /data/chronicles.sqlite]
//
// --db defaults to env DATABASE_PATH, else ./chronicles.sqlite (matches the app).
// tts_audio_cache is intentionally skipped on export — it is a regenerable TTS
// cache, not story state.

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import Database from 'better-sqlite3'

const SKIP_TABLES = new Set(['tts_audio_cache'])
const BLOB_TAG = '__blob_b64__'

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k.startsWith('--')) args[k.slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i]
    else args._.push(k)
  }
  return args
}

function resolveDbPath(a) {
  return a.db ?? process.env.DATABASE_PATH ?? path.join(process.cwd(), 'chronicles.sqlite')
}

// Tables that carry a world_id column, in a stable order (worlds first).
function worldScopedTables(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((t) => t.name)
  const scoped = ['worlds']
  for (const t of tables) {
    if (t === 'worlds' || SKIP_TABLES.has(t)) continue
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name)
    if (cols.includes('world_id')) scoped.push(t)
  }
  return scoped
}

function encodeRow(row) {
  const out = {}
  for (const [k, v] of Object.entries(row)) {
    out[k] = Buffer.isBuffer(v) ? { [BLOB_TAG]: v.toString('base64') } : v
  }
  return out
}

function decodeValue(v) {
  if (v && typeof v === 'object' && BLOB_TAG in v) return Buffer.from(v[BLOB_TAG], 'base64')
  return v
}

function doExport(a) {
  if (!a['source-id'] || !a.out) {
    console.error('export requires --source-id <id> and --out <file>')
    process.exit(1)
  }
  const sourceId = Number(a['source-id'])
  const dbPath = resolveDbPath(a)
  const db = new Database(dbPath, { readonly: true })

  const world = db.prepare('SELECT * FROM worlds WHERE id = ?').get(sourceId)
  if (!world) {
    console.error(`world ${sourceId} not found in ${dbPath}`)
    process.exit(1)
  }

  const tables = {}
  let total = 0
  for (const t of worldScopedTables(db)) {
    const rows =
      t === 'worlds'
        ? db.prepare('SELECT * FROM worlds WHERE id = ?').all(sourceId)
        : db.prepare(`SELECT * FROM ${t} WHERE world_id = ?`).all(sourceId)
    tables[t] = rows.map(encodeRow)
    total += rows.length
  }

  const payload = {
    schemaUserVersion: db.pragma('user_version', { simple: true }),
    sourceWorldId: sourceId,
    sourceWorldName: world.name,
    exportedFrom: dbPath,
    tables,
  }
  writeFileSync(a.out, JSON.stringify(payload))
  console.log(`[export] world #${sourceId} "${world.name}" -> ${a.out}`)
  for (const [t, rows] of Object.entries(tables)) if (rows.length) console.log(`  ${t}: ${rows.length}`)
  console.log(`  total rows: ${total}, schema user_version: ${payload.schemaUserVersion}`)
  db.close()
}

function doImport(a) {
  if (!a.in) {
    console.error('import requires --in <file>')
    process.exit(1)
  }
  const payload = JSON.parse(readFileSync(a.in, 'utf8'))
  const dbPath = resolveDbPath(a)
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 10000')

  const targetVersion = db.pragma('user_version', { simple: true })
  if (targetVersion !== payload.schemaUserVersion) {
    console.error(
      `schema mismatch: export user_version ${payload.schemaUserVersion} != target ${targetVersion} (${dbPath}). Aborting.`,
    )
    process.exit(1)
  }

  // FK graph + pk/columns introspected from the TARGET schema.
  const fkGraph = {} // table -> [{ from, table }]
  const pkCol = {} // table -> pk column name
  const colList = {} // table -> [columns]
  for (const t of Object.keys(payload.tables)) {
    fkGraph[t] = db.prepare(`PRAGMA foreign_key_list(${t})`).all().map((f) => ({ from: f.from, table: f.table }))
    const info = db.prepare(`PRAGMA table_info(${t})`).all()
    pkCol[t] = info.find((c) => c.pk === 1)?.name ?? 'id'
    colList[t] = info.map((c) => c.name)
  }

  const idMap = {} // table -> Map(oldId -> newId)
  const inserted = {} // table -> [{ newId, old }]
  for (const t of Object.keys(payload.tables)) {
    idMap[t] = new Map()
    inserted[t] = []
  }

  // Insert 'worlds' first so the new world id is known; world_id participates in
  // cross-world UNIQUE indexes (e.g. characters_world_name), so it must be set to
  // the NEW id at insert time rather than left as an old placeholder.
  const tableOrder = ['worlds', ...Object.keys(payload.tables).filter((t) => t !== 'worlds')]
  let newWorldId = null

  // foreign_keys must be toggled OUTSIDE a transaction — `PRAGMA foreign_keys`
  // is a no-op once a BEGIN is active. The subgraph has circular FKs, so we
  // disable enforcement during the two-pass insert/remap and re-check explicitly
  // with foreign_key_check before commit.
  db.pragma('foreign_keys = OFF')

  const run = db.transaction(() => {
    // Pass 1: insert every row with a fresh pk. world_id is remapped immediately;
    // other FK values are left as old placeholders and rewritten in pass 2.
    for (const t of tableOrder) {
      const pk = pkCol[t]
      const insertCols = colList[t].filter((c) => c !== pk)
      const stmt = db.prepare(
        `INSERT INTO ${t} (${insertCols.join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`,
      )
      for (const row of payload.tables[t]) {
        const values = insertCols.map((c) => {
          if (c === 'world_id') {
            if (newWorldId === null) throw new Error('world_id seen before worlds row inserted')
            return newWorldId
          }
          return decodeValue(row[c])
        })
        const info = stmt.run(values)
        const newId = Number(info.lastInsertRowid)
        idMap[t].set(row[pk], newId)
        inserted[t].push({ newId, old: row })
      }
      if (t === 'worlds') newWorldId = idMap['worlds'].get(payload.sourceWorldId)
    }

    // Pass 2: rewrite every FK column using the id maps.
    for (const t of Object.keys(payload.tables)) {
      const pk = pkCol[t]
      const fks = fkGraph[t]
      if (!fks.length) continue
      for (const { newId, old } of inserted[t]) {
        const sets = []
        const vals = []
        for (const { from, table } of fks) {
          const oldVal = old[from]
          if (oldVal === null || oldVal === undefined) continue
          const mapped = idMap[table]?.get(oldVal)
          if (mapped === undefined) {
            throw new Error(`dangling FK: ${t}.${from} -> ${table} (old id ${oldVal}) has no mapping`)
          }
          sets.push(`${from} = ?`)
          vals.push(mapped)
        }
        if (!sets.length) continue
        vals.push(newId)
        db.prepare(`UPDATE ${t} SET ${sets.join(', ')} WHERE ${pk} = ?`).run(vals)
      }
    }

    // Optional rename of the new world (newWorldId set during pass 1).
    if (a.name) db.prepare('UPDATE worlds SET name = ? WHERE id = ?').run(a.name, newWorldId)

    const violations = db.prepare('PRAGMA foreign_key_check').all()
    if (violations.length) {
      throw new Error(`foreign_key_check failed with ${violations.length} violation(s): ${JSON.stringify(violations.slice(0, 5))}`)
    }
    return newWorldId
  })

  run()
  db.pragma('foreign_keys = ON')
  const finalName = a.name ?? payload.sourceWorldName
  console.log(`[import] "${finalName}" -> world #${newWorldId} in ${dbPath}`)
  for (const t of Object.keys(payload.tables)) {
    const n = payload.tables[t].length
    if (n) console.log(`  ${t}: ${n} rows (old #${payload.sourceWorldId} -> new #${newWorldId})`)
  }
  db.close()
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  const mode = a._[0]
  if (mode === 'export') doExport(a)
  else if (mode === 'import') doImport(a)
  else {
    console.error('usage: copy-world.mjs <export|import> ...')
    process.exit(1)
  }
}

main()
