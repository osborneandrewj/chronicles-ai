#!/usr/bin/env node
// One-shot: clone a world's premise into a new world with a fresh initial
// state. NO characters/places/scenes from the source carry over — the new
// world starts clean so every entity is created under the current
// archivist/NPC-agent rules (v0.6.7 geography + journey state, v0.6.8
// alias resolver). The opening turn is intentionally skipped; the first
// player action generates the opening narration via the existing chat
// route.
//
// Usage:
//   node clone-world-fresh.mjs \
//     --source-id 4 \
//     --name "Joe 2026 (fresh)" \
//     --location "Joseph's house on Rosebury Lane, Spokane, WA" \
//     --identity "Black t-shirt and jeans" \
//     --player-name "Joe" \
//     --time "Day 1 morning"
//
// Reuses the source world's setting_region rather than re-extracting (the
// premise is unchanged, so the answer is the same; saves one Haiku call).

import path from 'node:path'
import process from 'node:process'

import Database from 'better-sqlite3'

function parseArgs(argv) {
  const args = {}
  const aliases = {
    'source-id': 'sourceId',
    name: 'name',
    location: 'location',
    identity: 'identity',
    'player-name': 'playerName',
    time: 'time',
  }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (!k.startsWith('--')) continue
    const key = aliases[k.slice(2)]
    if (!key) continue
    args[key] = argv[++i]
  }
  return args
}

function derivePlaceName(location) {
  const head = location.split(/[—–.,]/)[0]?.trim() ?? location
  const cleaned = head.length > 0 ? head : location.trim()
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  for (const required of ['sourceId', 'name', 'location', 'time']) {
    if (!a[required]) {
      console.error(`missing required flag --${required}`)
      process.exit(1)
    }
  }

  const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'chronicles.sqlite')
  console.log(`[clone] opening ${dbPath}`)
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const source = db
    .prepare('SELECT id, name, premise, setting_region FROM worlds WHERE id = ?')
    .get(Number(a.sourceId))
  if (!source) {
    console.error(`source world ${a.sourceId} not found`)
    process.exit(1)
  }
  console.log(`[clone] source: #${source.id} "${source.name}" (region: ${source.setting_region ?? '(unset)'})`)

  const identity = a.identity ?? 'A figure, details unwritten.'
  const playerName = (a.playerName ?? 'Player').trim() || 'Player'
  const initialState = JSON.stringify({
    time: a.time,
    location: a.location,
    identity,
  })

  const tx = db.transaction(() => {
    const w = db
      .prepare(
        `INSERT INTO worlds (name, premise, initial_state_json, setting_region)
         VALUES (?, ?, ?, ?)
         RETURNING id, name`,
      )
      .get(a.name, source.premise, initialState, source.setting_region)

    const place = db
      .prepare(`INSERT INTO places (world_id, name, description) VALUES (?, ?, ?) RETURNING id`)
      .get(w.id, derivePlaceName(a.location), a.location)

    db.prepare(
      `INSERT INTO characters (world_id, name, description, is_player, current_place_id)
       VALUES (?, ?, ?, 1, ?)`,
    ).run(w.id, playerName, identity, place.id)

    const scene = db
      .prepare(
        `INSERT INTO scenes (world_id, place_id, title, scene_number, status, updated_at)
         VALUES (?, ?, 'Scene 1', 1, 'active', datetime('now')) RETURNING id`,
      )
      .get(w.id, place.id)

    db.prepare('UPDATE worlds SET world_time = ?, current_scene_id = ? WHERE id = ?').run(
      a.time,
      scene.id,
      w.id,
    )

    return { worldId: w.id, placeId: place.id, sceneId: scene.id }
  })
  const ids = tx()

  console.log(`[clone] created world #${ids.worldId} "${a.name}"`)
  console.log(`  - place #${ids.placeId}: ${derivePlaceName(a.location)}`)
  console.log(`  - scene #${ids.sceneId}: Scene 1 (active)`)
  console.log(`  - player "${playerName}" placed at place #${ids.placeId}`)
  console.log(`  - setting_region: ${source.setting_region ?? '(none)'}`)
  console.log(`  - geo will resolve on first chat turn`)
  console.log(`  - opening turn skipped — first player action generates it`)
  db.close()
}

main()
