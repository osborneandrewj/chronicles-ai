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
})
