import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { runMigrations } from '@/lib/migrations'

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
