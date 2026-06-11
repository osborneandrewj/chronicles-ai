import { describe, expect, it } from 'vitest'

import { db } from '@/lib/db'
import { SqliteTimelineWriter } from '@/infrastructure/persistence/sqlite/timeline-writer.sqlite'
import { SqliteWorldRepository } from '@/infrastructure/persistence/sqlite/world-repository.sqlite'

// SQLite-adapter test for the TimelineWriter append (starship P3). Runs against
// the shared in-memory db singleton (DATABASE_PATH=:memory: in the vitest config)
// with all migrations applied, scoping state per test by creating a fresh bounded
// world each time. Verifies a sim beat lands as a readable row carrying
// provenance='sim', the sim_tick, world_time, and title — with turn_id null.

const worlds = new SqliteWorldRepository()
const timeline = new SqliteTimelineWriter()

type TimelineRow = {
  world_id: number
  turn_id: number | null
  thread_id: number | null
  world_time: string | null
  title: string
  summary: string
  importance: number
  sim_tick: number | null
  provenance: string
  created_at: string
}

async function createWorld(name: string): Promise<number> {
  const { id } = await worlds.createBounded({
    name,
    premise: 'A small scout ship adrift.',
    initialStateJson: JSON.stringify({ time: 'Morning' }),
    templateId: 'scout',
  })
  return id
}

function rowsFor(worldId: number): TimelineRow[] {
  return db
    .prepare(
      `SELECT world_id, turn_id, thread_id, world_time, title, summary, importance,
              sim_tick, provenance, created_at
       FROM timeline_events WHERE world_id = ? ORDER BY id ASC`,
    )
    .all(worldId) as TimelineRow[]
}

describe('SqliteTimelineWriter.append', () => {
  it("writes a sim beat row readable with provenance='sim' and the right fields", async () => {
    const worldId = await createWorld(`timeline-${Math.random()}`)

    await timeline.append({
      world_id: worldId,
      turn_id: null,
      thread_id: null,
      world_time: 'Day 2 — evening',
      title: 'Argument over the rationing schedule',
      summary: 'Vance and Okonkwo clashed over cutting the night watch.',
      importance: 3,
      sim_tick: 7,
      provenance: 'sim',
    })

    const rows = rowsFor(worldId)
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.provenance).toBe('sim')
    expect(row.sim_tick).toBe(7)
    expect(row.turn_id).toBeNull()
    expect(row.world_time).toBe('Day 2 — evening')
    expect(row.title).toBe('Argument over the rationing schedule')
    expect(row.summary).toBe('Vance and Okonkwo clashed over cutting the night watch.')
    expect(row.importance).toBe(3)
    expect(row.created_at).toBeTruthy()
  })

  it('appends multiple beats for the same world in order', async () => {
    const worldId = await createWorld(`timeline-multi-${Math.random()}`)

    await timeline.append({
      world_id: worldId,
      turn_id: null,
      thread_id: null,
      world_time: 'Day 1 — morning',
      title: 'First beat',
      summary: 'A.',
      importance: 2,
      sim_tick: 1,
      provenance: 'sim',
    })
    await timeline.append({
      world_id: worldId,
      turn_id: null,
      thread_id: null,
      world_time: 'Day 1 — night',
      title: 'Second beat',
      summary: 'B.',
      importance: 4,
      sim_tick: 3,
      provenance: 'sim',
    })

    const rows = rowsFor(worldId)
    expect(rows.map((r) => r.title)).toEqual(['First beat', 'Second beat'])
    expect(rows.map((r) => r.sim_tick)).toEqual([1, 3])
  })
})
