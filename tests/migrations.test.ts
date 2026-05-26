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

    expect(db.pragma('user_version', { simple: true })).toBe(9)
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

  it('handles malformed turn_states.state_json by using LEGACY fallback (not initial_state_json)', () => {
    // The production-likely failure mode: a world has 20+ turn_states, one of
    // them was written during an LLM error and is malformed, and that one
    // happens to be the latest. The valid initial_state_json is NOT used —
    // the migration uses LEGACY_STATE_FALLBACK constants instead. Surprising
    // but stable; recorded here so future changes that "improve" the
    // fall-through must do so consciously.
    const db = seedV4Database()
    db.prepare(
      `INSERT INTO worlds (id, name, premise, initial_state_json) VALUES (?, ?, ?, ?)`,
    ).run(
      1,
      'Corrupt Latest',
      'Premise.',
      JSON.stringify({
        time: 'Dawn, day 3',
        location: 'The crow road above Mevagissey',
        identity: 'Returned letter-writer.',
      }),
    )
    db.prepare(`INSERT INTO turns (world_id, role, content) VALUES (?, ?, ?)`).run(
      1, 'user', 'I keep walking.',
    )
    db.prepare(`INSERT INTO turns (world_id, role, content) VALUES (?, ?, ?)`).run(
      1, 'assistant', 'The road bends...',
    )
    // The latest turn_state is garbage — simulates a half-flushed write or
    // an upstream archiver bug.
    db.prepare(
      `INSERT INTO turn_states (turn_id, world_id, state_json) VALUES (?, ?, ?)`,
    ).run(2, 1, '{"time": "broken')

    expect(() => runMigrations(db)).not.toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(9)
    expect(db.pragma('foreign_key_check')).toEqual([])

    // initial_state_json was valid but is NOT consulted — current code uses
    // `latest?.state_json ?? initial_state_json`, so a defined-but-malformed
    // latest short-circuits the fallback.
    const world = db.prepare('SELECT world_time FROM worlds WHERE id = 1').get() as {
      world_time: string
    }
    expect(world.world_time).toBe('Day 1, morning')

    const place = db.prepare('SELECT name FROM places WHERE world_id = 1').get() as { name: string }
    expect(place.name).toBe('Opening scene')
  })
})

function scene_id(world: { current_scene_id: number }): number {
  return world.current_scene_id
}

describe('v6 migration (npc_goal_attitude)', () => {
  // The v0.5 backfill seeds one player character per world. After v6 those
  // characters must have active_goal and current_attitude columns, both NULL.
  it('adds nullable active_goal + current_attitude to characters; defaults to NULL', () => {
    const db = seedV4Database()
    db.prepare(
      `INSERT INTO worlds (id, name, premise, initial_state_json) VALUES (?, ?, ?, ?)`,
    ).run(
      1,
      'Test World',
      'p',
      JSON.stringify({
        time: 'Late afternoon',
        location: 'Mevagissey harbour',
        identity: 'Travel-worn letter-writer.',
      }),
    )

    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(9)
    expect(db.pragma('foreign_key_check')).toEqual([])

    const cols = db.prepare("PRAGMA table_info('characters')").all() as Array<{
      name: string
      type: string
      notnull: number
      dflt_value: string | null
    }>
    const byName = new Map(cols.map((c) => [c.name, c]))

    const goal = byName.get('active_goal')
    expect(goal).toBeDefined()
    expect(goal?.type.toUpperCase()).toBe('TEXT')
    expect(goal?.notnull).toBe(0)
    expect(goal?.dflt_value).toBeNull()

    const attitude = byName.get('current_attitude')
    expect(attitude).toBeDefined()
    expect(attitude?.type.toUpperCase()).toBe('TEXT')
    expect(attitude?.notnull).toBe(0)
    expect(attitude?.dflt_value).toBeNull()

    // The v5-seeded player character carries NULL for both new fields.
    const player = db
      .prepare(
        'SELECT name, is_player, active_goal, current_attitude FROM characters WHERE world_id = 1',
      )
      .get() as {
      name: string
      is_player: number
      active_goal: string | null
      current_attitude: string | null
    }
    expect(player.is_player).toBe(1)
    expect(player.active_goal).toBeNull()
    expect(player.current_attitude).toBeNull()
  })

  it('lets new INSERTs set goal/attitude and lets UPDATEs clear them', () => {
    const db = seedV4Database()
    db.prepare(
      `INSERT INTO worlds (id, name, premise, initial_state_json) VALUES (?, ?, ?, ?)`,
    ).run(
      2,
      'Inn World',
      'p',
      JSON.stringify({ time: 't', location: 'l', identity: 'i' }),
    )
    runMigrations(db)

    const placeId = (
      db.prepare('SELECT id FROM places WHERE world_id = 2').get() as { id: number }
    ).id
    db.prepare(
      `INSERT INTO characters (world_id, name, description, is_player, current_place_id,
                               active_goal, current_attitude)
       VALUES (?, ?, ?, 0, ?, ?, ?)`,
    ).run(
      2,
      'Innkeeper',
      'Round-faced, wary.',
      placeId,
      'sell the player a room',
      'polite but probing',
    )

    const innkeeper = db
      .prepare(
        `SELECT name, active_goal, current_attitude FROM characters
         WHERE world_id = 2 AND name = 'Innkeeper'`,
      )
      .get() as { name: string; active_goal: string | null; current_attitude: string | null }
    expect(innkeeper.active_goal).toBe('sell the player a room')
    expect(innkeeper.current_attitude).toBe('polite but probing')

    db.prepare(
      `UPDATE characters SET active_goal = NULL, current_attitude = NULL WHERE name = 'Innkeeper'`,
    ).run()
    const cleared = db
      .prepare(
        `SELECT active_goal, current_attitude FROM characters
         WHERE world_id = 2 AND name = 'Innkeeper'`,
      )
      .get() as { active_goal: string | null; current_attitude: string | null }
    expect(cleared.active_goal).toBeNull()
    expect(cleared.current_attitude).toBeNull()
  })
})

describe('v7 migration (character_observations)', () => {
  it('adds a nullable observations column to characters; defaults to NULL', () => {
    const db = seedV4Database()
    db.prepare(
      `INSERT INTO worlds (id, name, premise, initial_state_json) VALUES (?, ?, ?, ?)`,
    ).run(
      1,
      'Test World',
      'p',
      JSON.stringify({
        time: 'Late afternoon',
        location: 'Mevagissey harbour',
        identity: 'Travel-worn letter-writer.',
      }),
    )

    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(9)
    expect(db.pragma('foreign_key_check')).toEqual([])

    const cols = db.prepare("PRAGMA table_info('characters')").all() as Array<{
      name: string
      type: string
      notnull: number
      dflt_value: string | null
    }>
    const observations = cols.find((c) => c.name === 'observations')
    expect(observations).toBeDefined()
    expect(observations?.type.toUpperCase()).toBe('TEXT')
    expect(observations?.notnull).toBe(0)
    expect(observations?.dflt_value).toBeNull()

    const player = db
      .prepare('SELECT observations FROM characters WHERE world_id = 1')
      .get() as { observations: string | null }
    expect(player.observations).toBeNull()
  })
})

describe('v8 migration (agentic_npcs)', () => {
  it('adds agency_level + 3 nullable text fields + appearance_count; defaults are safe', () => {
    const db = seedV4Database()
    db.prepare(
      `INSERT INTO worlds (id, name, premise, initial_state_json) VALUES (?, ?, ?, ?)`,
    ).run(
      1,
      'Test World',
      'p',
      JSON.stringify({
        time: 'Late afternoon',
        location: 'Mevagissey harbour',
        identity: 'Travel-worn letter-writer.',
      }),
    )

    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(9)
    expect(db.pragma('foreign_key_check')).toEqual([])

    const cols = db.prepare("PRAGMA table_info('characters')").all() as Array<{
      name: string
      type: string
      notnull: number
      dflt_value: string | null
    }>
    const byName = new Map(cols.map((c) => [c.name, c]))

    const agency = byName.get('agency_level')
    expect(agency?.type.toUpperCase()).toBe('TEXT')
    expect(agency?.notnull).toBe(1)
    expect(agency?.dflt_value).toBe("'npc'")

    const appearance = byName.get('appearance_count')
    expect(appearance?.type.toUpperCase()).toBe('INTEGER')
    expect(appearance?.notnull).toBe(1)
    expect(appearance?.dflt_value).toBe('0')

    for (const name of ['personal_goals', 'current_focus', 'recent_activity']) {
      const c = byName.get(name)
      expect(c?.type.toUpperCase()).toBe('TEXT')
      expect(c?.notnull).toBe(0)
      expect(c?.dflt_value).toBeNull()
    }

    // Backfilled player carries defaults: agency_level='npc', count=0.
    const player = db
      .prepare('SELECT agency_level, appearance_count FROM characters WHERE world_id = 1')
      .get() as { agency_level: string; appearance_count: number }
    expect(player.agency_level).toBe('npc')
    expect(player.appearance_count).toBe(0)
  })
})
