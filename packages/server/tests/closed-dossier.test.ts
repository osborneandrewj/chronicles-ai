import { describe, expect, it } from 'vitest'

import type { StoryDossier, StoryObjective, StoryThread } from '@/domain/entities'
import {
  buildArchivistClosedDossier,
  buildNpcStoryContext,
  countActiveDossierRows,
  selectRecentlyClosedObjectives,
  selectRecentlyClosedThreads,
} from '@/domain/services/closed-dossier'

function thread(
  partial: Partial<StoryThread> & Pick<StoryThread, 'id' | 'title' | 'status'>,
): StoryThread {
  return {
    world_id: 1,
    kind: 'quest',
    summary: null,
    stakes: null,
    rewards: null,
    consequences: null,
    hidden: null,
    relevance_tags_json: '[]',
    source_turn_id: null,
    resolved_turn_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

function objective(
  partial: Partial<StoryObjective> & Pick<StoryObjective, 'id' | 'title' | 'status'>,
): StoryObjective {
  return {
    world_id: 1,
    thread_id: null,
    thread_title: null,
    detail: null,
    blocker: null,
    source_turn_id: null,
    completed_turn_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

const emptyDossier = (): StoryDossier => ({
  threads: [],
  clues: [],
  objectives: [],
  resources: [],
  timeline: [],
})

describe('selectRecentlyClosedThreads', () => {
  it('returns only resolved/failed, newest closure first, capped', () => {
    const rows = selectRecentlyClosedThreads(
      [
        thread({ id: 1, title: 'Old', status: 'resolved', resolved_turn_id: 10 }),
        thread({ id: 2, title: 'Active', status: 'active' }),
        thread({ id: 3, title: 'New', status: 'failed', resolved_turn_id: 40 }),
        thread({ id: 4, title: 'Mid', status: 'resolved', resolved_turn_id: 20 }),
        thread({ id: 5, title: 'Dormant', status: 'dormant', resolved_turn_id: 50 }),
        thread({ id: 6, title: 'Also', status: 'resolved', resolved_turn_id: 30 }),
      ],
      3,
    )
    expect(rows.map((t) => t.title)).toEqual(['New', 'Also', 'Mid'])
  })
})

describe('selectRecentlyClosedObjectives', () => {
  it('returns completed/failed by completed_turn_id', () => {
    const rows = selectRecentlyClosedObjectives(
      [
        objective({ id: 1, title: 'A', status: 'completed', completed_turn_id: 5 }),
        objective({ id: 2, title: 'B', status: 'active' }),
        objective({ id: 3, title: 'C', status: 'failed', completed_turn_id: 9 }),
      ],
      5,
    )
    expect(rows.map((o) => o.title)).toEqual(['C', 'A'])
  })
})

describe('buildNpcStoryContext', () => {
  it('includes active pressures and recently closed rows', () => {
    const ctx = buildNpcStoryContext({
      ...emptyDossier(),
      threads: [
        thread({
          id: 1,
          title: 'Live quest',
          status: 'active',
          kind: 'quest',
          summary: 'Do the thing',
        }),
        thread({
          id: 2,
          title: 'Done quest',
          status: 'resolved',
          summary: 'Done',
          resolved_turn_id: 12,
        }),
      ],
      objectives: [
        objective({
          id: 1,
          title: 'Finish delivery',
          status: 'completed',
          detail: 'Dropped off',
          completed_turn_id: 11,
        }),
        objective({
          id: 2,
          title: 'Find key',
          status: 'active',
          detail: 'Still looking',
        }),
      ],
    })
    expect(ctx.active_pressures.some((p) => p.title === 'Live quest')).toBe(true)
    expect(ctx.recently_closed_threads.some((t) => t.title === 'Done quest')).toBe(true)
    expect(ctx.recently_closed_objectives.some((o) => o.title === 'Finish delivery')).toBe(true)
  })
})

describe('buildArchivistClosedDossier', () => {
  it('caps closed rows at archivist limits', () => {
    const threads = Array.from({ length: 8 }, (_, i) =>
      thread({
        id: i + 1,
        title: `T${i}`,
        status: 'resolved',
        resolved_turn_id: i + 1,
      }),
    )
    const closed = buildArchivistClosedDossier({ ...emptyDossier(), threads })
    expect(closed.recently_closed_threads).toHaveLength(5)
    expect(closed.recently_closed_threads[0].title).toBe('T7')
  })
})

describe('countActiveDossierRows', () => {
  it('counts active threads and active/blocked objectives', () => {
    expect(
      countActiveDossierRows({
        ...emptyDossier(),
        threads: [
          thread({ id: 1, title: 'A', status: 'active' }),
          thread({ id: 2, title: 'B', status: 'resolved' }),
        ],
        objectives: [
          objective({ id: 1, title: 'O1', status: 'active' }),
          objective({ id: 2, title: 'O2', status: 'blocked' }),
          objective({ id: 3, title: 'O3', status: 'completed' }),
        ],
      }),
    ).toBe(3)
  })
})
