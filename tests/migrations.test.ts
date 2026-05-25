import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { runMigrations } from '@/lib/migrations'

// Builds the v4 schema by hand, populates it with one world + a few turns +
// a turn_states snapshot, then runs migrations and asserts the v5 outcome.
// This is the exact migration path the live Railway DB will follow.
function seedV4Database(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = MEMORY')
  db.exec(`
    CREATE TABLE worlds (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT    NOT NULL,
      premise            TEXT    NOT NULL,
      initial_state_json TEXT    NOT NULL,
      created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE turns (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id   INTEGER NOT NULL REFERENCES worlds(id),
      role       TEXT    NOT NULL CHECK (role IN ('user','assistant')),
      content    TEXT    NOT NULL,
      metadata   TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE turn_states (
      turn_id    INTEGER PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
      world_id   INTEGER NOT NULL REFERENCES worlds(id),
      state_json TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX turns_world_id_id ON turns(world_id, id);
    CREATE INDEX turn_states_world_id_turn_id ON turn_states(world_id, turn_id);
  `)
  db.pragma('user_version = 4')
  return db
}

describe('v5 migration', () => {
  it('upgrades a v4 DB to v5 with no FK violations', () => {
    const db = seedV4Database()
    db.prepare(
      `INSERT INTO worlds (id, name, premise, initial_state_json) VALUES (?, ?, ?, ?)`,
    ).run(
      1,
      'Test World',
      'Premise prose.',
      JSON.stringify({
        time: 'Late afternoon, autumn 1897',
        location: 'Mevagissey harbour, Cornwall — pubs and quay still in view',
        identity: 'Travel-worn letter-writer.',
      }),
    )
    db.prepare(`INSERT INTO turns (world_id, role, content) VALUES (?, ?, ?)`).run(
      1, 'user', 'I walk down the quay.',
    )
    db.prepare(`INSERT INTO turns (world_id, role, content) VALUES (?, ?, ?)`).run(
      1, 'assistant', 'The wind tugs at your coat...',
    )
    db.prepare(
      `INSERT INTO turn_states (turn_id, world_id, state_json) VALUES (?, ?, ?)`,
    ).run(
      2,
      1,
      JSON.stringify({
        time: 'Evening, autumn 1897',
        location: 'Quay end, near the lifeboat house',
        identity: 'Travel-worn letter-writer, jacket damp.',
      }),
    )

    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(5)
    expect(db.pragma('foreign_key_check')).toEqual([])

    // turn_states is gone.
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>
    expect(tables.map((t) => t.name)).not.toContain('turn_states')
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['characters', 'places', 'scenes', 'turns', 'worlds']),
    )

    // Backfill seeded a player + place + scene 1, and used the latest
    // turn_state's prose (Evening, autumn 1897) — not the initial JSON.
    const world = db.prepare("SELECT id, world_time, current_scene_id FROM worlds WHERE id = 1").get() as {
      id: number
      world_time: string
      current_scene_id: number
    }
    expect(world.world_time).toBe('Evening, autumn 1897')
    expect(world.current_scene_id).not.toBeNull()

    const player = db
      .prepare("SELECT name, is_player, description, current_place_id FROM characters WHERE world_id = 1")
      .get() as { name: string; is_player: number; description: string; current_place_id: number }
    expect(player.is_player).toBe(1)
    expect(player.description).toBe('Travel-worn letter-writer, jacket damp.')
    expect(player.current_place_id).not.toBeNull()

    const place = db
      .prepare("SELECT name, description FROM places WHERE world_id = 1")
      .get() as { name: string; description: string }
    expect(place.name).toBe('Quay end')
    expect(place.description).toBe('Quay end, near the lifeboat house')

    const scene = db
      .prepare("SELECT title, scene_number, status, opened_at_turn FROM scenes WHERE world_id = 1")
      .get() as { title: string; scene_number: number; status: string; opened_at_turn: number }
    expect(scene.title).toBe('Scene 1')
    expect(scene.scene_number).toBe(1)
    expect(scene.status).toBe('active')
    expect(scene.opened_at_turn).toBe(1)

    // Every existing turn is now attached to scene 1.
    const turnSceneIds = db.prepare('SELECT scene_id FROM turns WHERE world_id = 1').all() as Array<{
      scene_id: number
    }>
    expect(turnSceneIds.every((t) => t.scene_id === scene_id(world))).toBe(true)
  })

  it('falls back to initial_state_json when a world has no turn_states', () => {
    const db = seedV4Database()
    db.prepare(
      `INSERT INTO worlds (id, name, premise, initial_state_json) VALUES (?, ?, ?, ?)`,
    ).run(
      1,
      'Fresh World',
      'Premise.',
      JSON.stringify({
        time: 'Day 1, morning',
        location: 'A clearing in the woods',
        identity: 'Lost traveller.',
      }),
    )
    // No turns, no turn_states for this world.

    runMigrations(db)

    const world = db.prepare("SELECT world_time FROM worlds WHERE id = 1").get() as {
      world_time: string
    }
    expect(world.world_time).toBe('Day 1, morning')

    const place = db.prepare("SELECT name FROM places WHERE world_id = 1").get() as { name: string }
    expect(place.name).toBe('A clearing in the woods')

    const scene = db
      .prepare("SELECT scene_number, status, opened_at_turn FROM scenes WHERE world_id = 1")
      .get() as { scene_number: number; status: string; opened_at_turn: number | null }
    expect(scene.scene_number).toBe(1)
    expect(scene.status).toBe('active')
    expect(scene.opened_at_turn).toBeNull() // no turns → opened_at_turn stays null
  })

  it('handles malformed initial_state_json without crashing', () => {
    const db = seedV4Database()
    db.prepare(
      `INSERT INTO worlds (id, name, premise, initial_state_json) VALUES (?, ?, ?, ?)`,
    ).run(1, 'Broken', 'p', 'not json at all')

    expect(() => runMigrations(db)).not.toThrow()

    const place = db.prepare('SELECT name FROM places WHERE world_id = 1').get() as { name: string }
    // Falls back to the legacy fallback constant.
    expect(place.name).toBe('Opening scene')
  })
})

function scene_id(world: { current_scene_id: number }): number {
  return world.current_scene_id
}
