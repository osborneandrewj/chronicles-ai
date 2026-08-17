import { describe, expect, it } from 'vitest'

import { decideDirector } from '@/domain/services/director'
import type { RankableObjective, RankableThread } from '@/domain/services/dossier-ranking'
import { formatDirectorBlock } from '@/lib/world-state'

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
    expect(d.beatKind).toBeNull()
    expect(d.mustStage).toHaveLength(0)
    expect(d.mustNot).toHaveLength(0)
    expect(d.cast).toHaveLength(0)
  })

  it('applies a pending brain beat unless the player engages another thread', () => {
    const pending = {
      beatKind: 'reveal' as const,
      foregroundThreadId: 1,
      mustStage: ['Stage the papyrus seal'],
      mustNot: ['Do not open a new major arc this turn.'],
      cast: [{ characterId: 2, name: 'Setnakht', role: 'initiate' as const }],
      guidanceLines: ['Brain: keep the courier in frame'],
      reason: 'stall' as const,
      sourceTurnId: 8,
    }
    const used = decideDirector({
      threads: [
        thread({
          id: 1,
          title: 'The Sealed Papyrus',
          kind: 'quest',
          summary: 'Setnakht carries a letter',
          source_turn_id: 4,
        }),
        thread({
          id: 2,
          title: 'Temple politics',
          kind: 'threat',
          summary: 'The vizier watches',
          source_turn_id: 5,
        }),
      ],
      objectives: [],
      clockMinutes: 100,
      currentTurnId: 10,
      playerText: 'I ask about the papyrus',
      pendingBeat: pending,
    })
    expect(used.beatKind).toBe('reveal')
    expect(used.mustStage).toContain('Stage the papyrus seal')
    expect(used.cast[0]?.name).toBe('Setnakht')

    const overridden = decideDirector({
      threads: [
        thread({
          id: 1,
          title: 'The Sealed Papyrus',
          kind: 'quest',
          summary: 'Setnakht carries a letter',
          source_turn_id: 4,
        }),
        thread({
          id: 2,
          title: 'Temple politics',
          kind: 'threat',
          summary: 'The vizier watches',
          source_turn_id: 5,
        }),
      ],
      objectives: [],
      clockMinutes: 100,
      currentTurnId: 10,
      playerText: 'I confront the vizier about temple politics',
      pendingBeat: pending,
    })
    expect(overridden.mustStage).not.toContain('Stage the papyrus seal')
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
    expect(d.beatKind).toBe('stall_escalate')
    expect(d.mustStage.some((l) => /escalate/i.test(l))).toBe(true)
    expect(d.mustNot).toContain('Do not open a new major arc this turn.')
    expect(d.mustNot.every((l) => !/must climax|force climax/i.test(l))).toBe(true)
  })

  it('assigns one initiator from present cast and must-stage them', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 1,
          title: 'The Sealed Papyrus',
          kind: 'quest',
          summary: 'Setnakht carries a sealed letter',
          source_turn_id: 10,
        }),
      ],
      objectives: [],
      clockMinutes: 100,
      currentTurnId: 12,
      playerText: 'I ask what the papyrus holds',
      presentCast: [
        { id: 1, name: 'Joseph', isPlayer: true },
        { id: 2, name: 'Setnakht' },
        { id: 3, name: 'A temple porter' },
        { id: 4, name: 'A second scribe' },
        { id: 5, name: 'A door guard' },
      ],
    })
    expect(d.cast.filter((c) => c.role === 'initiate')).toEqual([
      { characterId: 2, name: 'Setnakht', role: 'initiate' },
    ])
    expect(d.cast.filter((c) => c.role === 'react')).toHaveLength(2)
    expect(d.cast.some((c) => c.role === 'background')).toBe(true)
    expect(d.cast.every((c) => c.name !== 'Joseph')).toBe(true)
    expect(d.mustStage.some((l) => /Setnakht initiates/i.test(l))).toBe(true)
    expect(d.mustStage.some((l) => /Sealed Papyrus/i.test(l))).toBe(true)
  })

  it('marks an en-route foreground name as arrive', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 1,
          title: 'Bring Marcus in',
          kind: 'quest',
          summary: 'Marcus is driving across town',
          source_turn_id: 4,
        }),
      ],
      objectives: [],
      clockMinutes: 100,
      currentTurnId: 8,
      playerText: 'I wait by the window',
      presentCast: [{ id: 1, name: 'Kyle' }],
      enRouteCast: [{ id: 9, name: 'Marcus' }],
    })
    expect(d.cast).toEqual(
      expect.arrayContaining([
        { characterId: 1, name: 'Kyle', role: 'initiate' },
        { characterId: 9, name: 'Marcus', role: 'arrive' },
      ]),
    )
    expect(d.beatKind).toBe('arrival')
  })
})

describe('formatDirectorBlock', () => {
  it('renders binding MUST STAGE / MUST NOT / CAST', () => {
    const d = decideDirector({
      threads: [
        thread({
          id: 1,
          title: 'Hit squad',
          kind: 'threat',
          stakes: 'death by dusk',
          source_turn_id: 8,
        }),
      ],
      objectives: [],
      clockMinutes: 100,
      currentTurnId: 10,
      playerText: 'I check the alley',
      presentCast: [{ id: 2, name: 'Lira' }],
    })
    const block = formatDirectorBlock(d, [
      {
        id: 1,
        title: 'Hit squad',
        kind: 'threat',
        status: 'active',
        summary: null,
        stakes: 'death by dusk',
      } as never,
    ])
    expect(block).toContain('## DIRECTOR')
    expect(block).toContain('MUST STAGE')
    expect(block).toContain('CAST')
    expect(block).toMatch(/initiate: Lira/)
    expect(block).toContain('same force as PLANNED MOVES')
    expect(block).not.toMatch(/Soft structural pressure/)
  })

  it('returns empty string when the beat is empty', () => {
    const d = decideDirector({
      threads: [],
      objectives: [],
      clockMinutes: 0,
      currentTurnId: 1,
      playerText: 'look around',
    })
    expect(formatDirectorBlock(d, [])).toBe('')
  })
})
