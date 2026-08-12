import { describe, expect, it } from 'vitest'

import type { StoryObjective, StoryThread } from '@/domain/entities'
import {
  applyLifecycleHygiene,
  hygieneFromClosedRows,
} from '@/domain/services/lifecycle-hygiene'

function thread(p: Partial<StoryThread> & Pick<StoryThread, 'id' | 'title'>): StoryThread {
  return {
    world_id: 1,
    kind: 'quest',
    status: 'active',
    summary: null,
    stakes: null,
    rewards: null,
    consequences: null,
    hidden: null,
    relevance_tags_json: '[]',
    source_turn_id: 1,
    resolved_turn_id: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...p,
  }
}

function objective(
  p: Partial<StoryObjective> & Pick<StoryObjective, 'id' | 'title'>,
): StoryObjective {
  return {
    world_id: 1,
    thread_id: null,
    thread_title: null,
    status: 'active',
    detail: null,
    blocker: null,
    source_turn_id: 1,
    completed_turn_id: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...p,
  }
}

describe('applyLifecycleHygiene', () => {
  it('Vigil-shaped: resolved papyrus completes sibling route objectives', () => {
    const threads = [
      thread({ id: 1, title: 'Sealed Papyrus', status: 'resolved' }),
      thread({ id: 2, title: 'Sealed Papyrus route', kind: 'quest' }),
    ]
    const objectives = [
      objective({
        id: 10,
        title: 'Decode papyrus',
        thread_id: 1,
        thread_title: 'Sealed Papyrus',
        status: 'active',
      }),
      objective({
        id: 11,
        title: 'Deliver translation',
        thread_id: 1,
        thread_title: 'Sealed Papyrus',
        status: 'active',
      }),
    ]
    const r = applyLifecycleHygiene({
      event: { type: 'thread_closed', threadId: 1, status: 'resolved' },
      threads,
      objectives,
      turnId: 50,
    })
    expect(r.objectiveWrites.map((w) => w.id).sort()).toEqual([10, 11])
    expect(r.objectiveWrites.every((w) => w.status === 'completed')).toBe(true)
    expect(r.threadWrites.some((w) => w.id === 2 && w.status === 'dormant')).toBe(true)
  })

  it('last objective complete suggests parent resolve', () => {
    const threads = [thread({ id: 1, title: 'Main quest' })]
    const objectives = [
      objective({
        id: 10,
        title: 'Only objective',
        thread_id: 1,
        thread_title: 'Main quest',
        status: 'completed',
      }),
    ]
    const r = applyLifecycleHygiene({
      event: { type: 'objective_completed', objectiveId: 10, threadId: 1 },
      threads,
      objectives,
      turnId: 12,
    })
    expect(r.threadWrites).toEqual([
      expect.objectContaining({ id: 1, status: 'resolved', reason: 'last_objective_completed' }),
    ])
  })

  it('hygieneFromClosedRows dedupes', () => {
    const threads = [thread({ id: 1, title: 'A' })]
    const objectives = [
      objective({ id: 10, title: 'O', thread_id: 1, thread_title: 'A' }),
    ]
    const r = hygieneFromClosedRows({
      closedThreadIds: [{ id: 1, status: 'resolved' }],
      completedObjectiveIds: [],
      threads,
      objectives,
      turnId: 1,
    })
    expect(r.objectiveWrites).toHaveLength(1)
  })
})
