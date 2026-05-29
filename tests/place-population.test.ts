import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import {
  db,
  getLatestOccupancySnapshotRow,
  getPopulationTemplatesForKind,
  insertOccupancySnapshot,
} from '@/lib/db'
import { runMigrations } from '@/lib/migrations'
import { createWorld } from '@/lib/worlds'

function freshWorld(): number {
  return createWorld({
    name: `Pop-${Math.random()}`,
    premise: 'A quiet town with secrets.',
    initialState: {
      time: 'Day 1, 20:00',
      location: 'The Anchor Tavern',
      identity: 'A traveler.',
      playerName: 'Wren',
    },
  }).id
}

describe('migration v22 — place population schema', () => {
  it('creates the three tables, the threads tag column, and passes FK check', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(22)

    const tables = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'",
    ).all() as Array<{ name: string }>).map((r) => r.name)
    expect(tables).toContain('place_profiles')
    expect(tables).toContain('population_templates')
    expect(tables).toContain('place_occupancy_snapshots')

    const threadCols = (db.prepare('PRAGMA table_info(story_threads)').all() as Array<{
      name: string
    }>).map((c) => c.name)
    expect(threadCols).toContain('relevance_tags_json')

    expect((db.pragma('foreign_key_check') as unknown[]).length).toBe(0)
    db.close()
  })
})

describe('occupancy snapshot persistence', () => {
  it('round-trips a snapshot row as JSON', () => {
    const worldId = freshWorld()
    const placeId = (db.prepare(
      "SELECT id FROM places WHERE world_id = ? LIMIT 1",
    ).get(worldId) as { id: number }).id

    insertOccupancySnapshot({
      worldId,
      placeId,
      sceneId: null,
      sourceTurnId: null,
      worldTime: 'Day 1, 20:00',
      occupancyJson: '{"density":"busy","seed":"abc","groups":[],"traffic":null,"encounter_hooks":[]}',
    })

    const row = getLatestOccupancySnapshotRow(worldId, placeId)
    expect(row).not.toBeNull()
    expect(JSON.parse(row!.occupancy_json).density).toBe('busy')
  })

  it('returns empty array when no population_templates exist for the world', () => {
    const worldId = freshWorld()
    expect(getPopulationTemplatesForKind(worldId, 'bar')).toEqual([])
  })
})
