import { describe, expect, it } from 'vitest'

import { decideDirector } from '@/domain/services/director'
import type { RankableObjective, RankableThread } from '@/domain/services/dossier-ranking'

function thread(
  partial: Partial<RankableThread> & Pick<RankableThread, 'id' | 'title' | 'kind'>,
): RankableThread {
  return {
    status: 'active',
    summary: null,
    stakes: null,
    consequences: null,
    hidden: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    source_turn_id: 1,
    ...partial,
  }
}

function objective(
  partial: Partial<RankableObjective> & Pick<RankableObjective, 'id' | 'title'>,
): RankableObjective {
  return {
    status: 'active',
    detail: null,
    blocker: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    source_turn_id: 1,
    ...partial,
  }
}

describe('decideDirector', () => {
  it('returns empty beat when no actives', () => {
    const d = decideDirector({
      threads: [],
      objectives: [],
      clockMinutes: 100,
      currentTurnId: 10,
      playerText: 'look around',
    })
    expect(d.foregroundThreadId).toBeNull()
    expect(d.guidanceLines).toHaveLength(0)
  })

  it('picks one foreground among Threshold-shaped multi-threat pile', () => {
    const threads = [
      thread({
        id: 1,
        title: 'Quiet audit',
        kind: 'background',
        stakes: 'minor paperwork',
        source_turn_id: 5,
      }),
      thread({
        id: 2,
        title: 'Corporate hit squad',
        kind: 'threat',
        stakes: 'death if they find you by dusk',
        source_turn_id: 20,
      }),
      thread({
        id: 3,
        title: 'Missing courier',
        kind: 'mystery',
        stakes: 'urgent lead',
        source_turn_id: 18,
      }),
      thread({
        id: 4,
        title: 'Blackmail ledger',
        kind: 'threat',
        stakes: 'career-ending exposure',
        source_turn_id: 15,
      }),
      thread({
        id: 5,
        title: 'Side romance',
        kind: 'relationship',
        stakes: null,
        source_turn_id: 2,
      }),
      thread({
        id: 6,
        title: 'Main contract',
        kind: 'quest',
        stakes: 'must deliver before Day 3 dusk or die',
        source_turn_id: 19,
      }),
    ]
    const d = decideDirector({
      threads,
      objectives: [
        objective({ id: 10, title: 'Reach the vault logs' }),
        objective({ id: 11, title: 'Pay the debt' }),
      ],
      clockMinutes: (3 - 1) * 1440 + 18 * 60, // Day 3 evening-ish
      currentTurnId: 50,
      playerText: 'I check the hit squad intel',
    })
    expect(d.foregroundThreadId).not.toBeNull()
    expect(d.guidanceLines.length).toBeGreaterThan(0)
    // Heavy pressure capped — not all 6 threads are heavy.
    expect(d.heavyThreadIds.length).toBeLessThanOrEqual(4)
    expect(d.backgroundThreadIds.length).toBeGreaterThan(0)
  })

  it('Meridian-shaped many objectives still one foreground thread', () => {
    const threads = [
      thread({
        id: 1,
        title: 'Sequence Vigil investigation',
        kind: 'quest',
        stakes: 'operator clearance and program control',
        source_turn_id: 100,
      }),
    ]
    const objectives = Array.from({ length: 7 }, (_, i) =>
      objective({ id: i + 1, title: `Objective ${i + 1}`, detail: 'active route' }),
    )
    const d = decideDirector({
      threads,
      objectives,
      clockMinutes: 200,
      currentTurnId: 120,
      playerText: 'continue the investigation',
    })
    expect(d.foregroundThreadId).toBe(1)
    expect(d.phase).toBeTruthy()
  })

  it('stalls escalate guidance without hard climax mandate', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 1,
          title: 'Stalled plot',
          kind: 'quest',
          stakes: 'something important',
          source_turn_id: 1,
        }),
      ],
      objectives: [],
      clockMinutes: 100,
      currentTurnId: 40,
      playerText: 'I drink coffee and stare at the wall',
    })
    expect(d.guidanceLines.some((l) => /stall/i.test(l))).toBe(true)
    expect(d.guidanceLines.every((l) => !/must climax|force climax/i.test(l))).toBe(true)
  })
})
