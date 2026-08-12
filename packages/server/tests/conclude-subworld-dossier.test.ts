import { describe, expect, it } from 'vitest'

import type { StoryObjective, StoryThread } from '@/domain/entities'
import { concludeSubworldDossier } from '@/domain/services/conclude-subworld-dossier'

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

describe('concludeSubworldDossier', () => {
  it('awakening leaves threads dormant and objectives failed as left unresolved', () => {
    const r = concludeSubworldDossier({
      threads: [thread({ id: 1, title: 'Cluster deadline' })],
      objectives: [objective({ id: 2, title: 'Survive Day 3' })],
      exitKind: 'awakening',
      turnId: 99,
      subworldName: 'Cluster Psi-1',
    })
    expect(r.threadWrites[0]).toMatchObject({
      id: 1,
      status: 'dormant',
      reason: 'subworld_exit_left_unresolved',
    })
    expect(r.objectiveWrites[0]).toMatchObject({
      id: 2,
      status: 'failed',
    })
    expect(r.objectiveWrites[0]!.blocker).toMatch(/Left the simulation/)
    expect(r.hubAftermathTitle).toContain('Cluster Psi-1')
  })

  it('death fails actives harder', () => {
    const r = concludeSubworldDossier({
      threads: [thread({ id: 1, title: 'Survive' })],
      objectives: [objective({ id: 2, title: 'Get out' })],
      exitKind: 'death',
      turnId: 10,
      subworldName: 'Sequence Vigil',
    })
    expect(r.threadWrites[0]!.status).toBe('failed')
    expect(r.objectiveWrites[0]!.status).toBe('failed')
    expect(r.hubAftermathSummary).toMatch(/death/i)
  })

  it('ignores already closed rows', () => {
    const r = concludeSubworldDossier({
      threads: [thread({ id: 1, title: 'Done', status: 'resolved' })],
      objectives: [objective({ id: 2, title: 'Done', status: 'completed' })],
      exitKind: 'awakening',
      turnId: 1,
    })
    expect(r.threadWrites).toHaveLength(0)
    expect(r.objectiveWrites).toHaveLength(0)
  })
})
