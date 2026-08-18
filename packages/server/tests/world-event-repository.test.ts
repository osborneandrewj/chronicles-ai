import { describe, expect, it } from 'vitest'

import { SqliteWorldEventRepository } from '@/infrastructure/persistence/sqlite/world-event-repository.sqlite'
import { SqliteWorldRepository } from '@/infrastructure/persistence/sqlite/world-repository.sqlite'

const worlds = new SqliteWorldRepository()
const worldEvents = new SqliteWorldEventRepository()

async function createWorld(name: string): Promise<number> {
  const { id } = await worlds.createBounded({
    name,
    premise: 'A quiet test vessel.',
    initialStateJson: JSON.stringify({ time: 'Morning' }),
    templateId: 'scout',
  })
  return id
}

describe('SqliteWorldEventRepository', () => {
  it('appends and returns newest first, capped', async () => {
    const worldId = await createWorld(`events-${Math.random()}`)
    await worldEvents.append({
      world_id: worldId,
      turn_id: 1,
      world_time: 'morning',
      kind: 'BEAT_DIRECTED',
      source_agent: 'director',
      actor_id: null,
      thread_id: 4,
      payload: { beatKind: 'pressure' },
      visibility: 'system',
    })
    await worldEvents.append({
      world_id: worldId,
      turn_id: 1,
      world_time: 'morning',
      kind: 'NPC_STAGED',
      source_agent: 'reconciler',
      actor_id: 9,
      thread_id: null,
      payload: { intent_id: 3, disposition: 'staged' },
      visibility: 'system',
    })

    const recent = await worldEvents.recentForWorld(worldId, 20)
    expect(recent).toHaveLength(2)
    expect(recent[0].kind).toBe('NPC_STAGED')
    expect(recent[1].kind).toBe('BEAT_DIRECTED')
    expect(recent[1].payload).toEqual({ beatKind: 'pressure' })
    expect(recent[0].actor_id).toBe(9)

    const capped = await worldEvents.recentForWorld(worldId, 1)
    expect(capped).toHaveLength(1)
    expect(capped[0].kind).toBe('NPC_STAGED')
  })

  it('round-trips a conductor OUTCOME_RESOLVED row', async () => {
    const worldId = await createWorld(`events-conductor-${Math.random()}`)
    await worldEvents.append({
      world_id: worldId,
      turn_id: 4,
      world_time: 'dusk',
      kind: 'OUTCOME_RESOLVED',
      source_agent: 'conductor',
      actor_id: null,
      thread_id: null,
      payload: { outcome: 'partial_success' },
      visibility: 'system',
    })
    const recent = await worldEvents.recentForWorld(worldId, 1)
    expect(recent[0]).toMatchObject({
      kind: 'OUTCOME_RESOLVED',
      source_agent: 'conductor',
      payload: { outcome: 'partial_success' },
    })
  })

  it('does not leak events across worlds', async () => {
    const a = await createWorld(`events-a-${Math.random()}`)
    const b = await createWorld(`events-b-${Math.random()}`)
    await worldEvents.append({
      world_id: a,
      turn_id: 2,
      world_time: null,
      kind: 'BEAT_DIRECTED',
      source_agent: 'director',
      actor_id: null,
      thread_id: null,
      payload: { world: 'a' },
      visibility: 'system',
    })
    expect(await worldEvents.recentForWorld(b)).toEqual([])
  })

  it('filters recent rows by kind so Story tab is not buried in NPC_*', async () => {
    const worldId = await createWorld(`events-filter-${Math.random()}`)
    await worldEvents.append({
      world_id: worldId,
      turn_id: 1,
      world_time: 'morning',
      kind: 'NPC_STAGED',
      source_agent: 'reconciler',
      actor_id: 2,
      thread_id: null,
      payload: {},
      visibility: 'system',
    })
    await worldEvents.append({
      world_id: worldId,
      turn_id: 1,
      world_time: 'morning',
      kind: 'THREAD_CLOSED',
      source_agent: 'director',
      actor_id: null,
      thread_id: 7,
      payload: { title: 'The Heist' },
      visibility: 'system',
    })
    await worldEvents.append({
      world_id: worldId,
      turn_id: 1,
      world_time: 'morning',
      kind: 'OUTCOME_RESOLVED',
      source_agent: 'conductor',
      actor_id: null,
      thread_id: null,
      payload: { result: 'failure' },
      visibility: 'system',
    })
    const story = await worldEvents.recentForWorld(worldId, 20, [
      'OUTCOME_RESOLVED',
    ])
    expect(story).toHaveLength(1)
    expect(story[0].kind).toBe('OUTCOME_RESOLVED')
  })
})
