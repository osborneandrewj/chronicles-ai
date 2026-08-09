import { describe, expect, it } from 'vitest'

import type { StoryObjective, StoryThread } from '@/domain/entities'
import {
  extractDeadlineMinutes,
  pickPrimaryPressure,
  rankObjectives,
  rankQuests,
} from '@/domain/services/dossier-ranking'
import { formatDossierBlock } from '@/lib/world-state'

function obj(
  partial: Partial<StoryObjective> & Pick<StoryObjective, 'id' | 'title'>,
): StoryObjective {
  return {
    world_id: 1,
    thread_id: null,
    thread_title: null,
    status: 'active',
    detail: null,
    blocker: null,
    source_turn_id: null,
    completed_turn_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

function thread(
  partial: Partial<StoryThread> & Pick<StoryThread, 'id' | 'title'>,
): StoryThread {
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
    source_turn_id: null,
    resolved_turn_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

describe('rankObjectives (R8)', () => {
  it('renders the deadline-nearest / highest-stakes 5, not the 5 oldest', () => {
    const objectives = [
      obj({ id: 1, title: 'Stale errand A', source_turn_id: 1, detail: 'old' }),
      obj({ id: 2, title: 'Stale errand B', source_turn_id: 2, detail: 'old' }),
      obj({ id: 3, title: 'Stale errand C', source_turn_id: 3, detail: 'old' }),
      obj({ id: 4, title: 'Stale errand D', source_turn_id: 4, detail: 'old' }),
      obj({ id: 5, title: 'Stale errand E', source_turn_id: 5, detail: 'old' }),
      obj({
        id: 6,
        title: 'Deliver to the Archon before Day 3 dusk',
        source_turn_id: 100,
        detail: 'deadline Day 3 evening — critical',
      }),
      obj({
        id: 7,
        title: 'Secure warehouse manifest pages',
        source_turn_id: 50,
        detail: 'pages taken; delivery still open',
      }),
      obj({
        id: 8,
        title: 'Hit the Archon',
        source_turn_id: 200,
        detail: 'player-invented high-stakes goal — death and pursuit',
      }),
    ]

    // Clock near Day 3 evening → deadline objective ranks high; newest high-stakes too.
    const ranked = rankObjectives(objectives, { clockMinutes: 2 * 1440 + 18 * 60 }, 5)
    const titles = ranked.map((o) => o.title)
    expect(titles).toContain('Deliver to the Archon before Day 3 dusk')
    expect(titles).toContain('Hit the Archon')
    // Oldest pure stale should be evicted when better candidates exist.
    expect(titles.filter((t) => t.startsWith('Stale')).length).toBeLessThan(5)
  })

  it('falls back to stakes + recency when no parseable deadline', () => {
    const objectives = [
      obj({ id: 1, title: 'Buy bread', source_turn_id: 1 }),
      obj({
        id: 2,
        title: 'Stop the assassination',
        source_turn_id: 2,
        detail: 'urgent — death threat against the senator',
      }),
    ]
    const ranked = rankObjectives(objectives, { clockMinutes: null }, 1)
    expect(ranked[0]?.title).toBe('Stop the assassination')
  })
})

describe('extractDeadlineMinutes', () => {
  it('parses Day N + band from free text', () => {
    expect(extractDeadlineMinutes('before Day 3 dusk')).toBe(2 * 1440 + 19 * 60)
  })
})

describe('pickPrimaryPressure + formatDossierBlock', () => {
  it('picks the highest-stakes quest and renders PRIMARY PRESSURE pin', () => {
    const threads = [
      thread({
        id: 1,
        title: 'Secure the warehouse manifests',
        kind: 'quest',
        stakes: 'Naval stores vanish without proof',
        source_turn_id: 10,
      }),
      thread({
        id: 2,
        title: 'Spartan token bargain',
        kind: 'mystery',
        source_turn_id: 5,
      }),
    ]
    const primary = pickPrimaryPressure(threads, [], { clockMinutes: null })
    expect(primary?.title).toBe('Secure the warehouse manifests')

    const block = formatDossierBlock(
      {
        threads,
        objectives: [],
        clues: [],
        resources: [],
        timeline: [],
      },
      { worldTime: 'Day 2 — morning' },
    )
    expect(block).toContain('### PRIMARY PRESSURE')
    expect(block).toContain('Secure the warehouse manifests')
    expect(block).toContain('world time: Day 2 — morning')
  })

  it('rankQuests prefers threat-adjacent high stakes', () => {
    const quests = [
      thread({ id: 1, title: 'Fetch wine', kind: 'quest', source_turn_id: 1 }),
      thread({
        id: 2,
        title: 'Stop the massacre',
        kind: 'quest',
        stakes: 'death and blood in the agora',
        source_turn_id: 2,
      }),
    ]
    expect(rankQuests(quests, { clockMinutes: null }, 1)[0]?.title).toBe('Stop the massacre')
  })
})
