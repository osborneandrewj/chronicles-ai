import { describe, expect, it } from 'vitest'

import {
  BASIC_PLOTS,
  isSomaticProcedureThread,
  pickSeedPlotShapes,
  resolveNewThreadKind,
} from '@/domain/services/basic-plots'
import { draftOpeningPlots } from '@/domain/services/opening-plots'

describe('Booker basic plots', () => {
  it('lists seven named shapes', () => {
    expect(BASIC_PLOTS).toHaveLength(7)
    expect(BASIC_PLOTS.map((p) => p.id)).toEqual([
      'overcoming_the_monster',
      'rags_to_riches',
      'the_quest',
      'voyage_and_return',
      'comedy',
      'tragedy',
      'rebirth',
    ])
  })

  it('picks distinct shapes deterministically', () => {
    const a = pickSeedPlotShapes(42, 3)
    const b = pickSeedPlotShapes(42, 3)
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id))
    expect(new Set(a.map((p) => p.id)).size).toBe(3)
  })
})

describe('somatic procedure threads', () => {
  it('detects a clawing-arm style threat', () => {
    expect(
      isSomaticProcedureThread({
        title: 'The Clawing Arm',
        summary: 'Right arm spasming into a rigid claw with asymmetric blood-pressure spikes.',
      }),
    ).toBe(true)
  })

  it('does not flag an institutional antagonist', () => {
    expect(
      isSomaticProcedureThread({
        title: 'The Face Lena Hides',
        summary: 'The director will burn a newcomer to keep the program buried.',
      }),
    ).toBe(false)
  })

  it('downgrades a new somatic threat when a mystery already exists', () => {
    const kind = resolveNewThreadKind(
      { title: 'The Clawing Arm', kind: 'threat', summary: 'The tremor locks into a claw.' },
      [
        {
          title: 'What the Sessions Are For',
          kind: 'mystery',
          status: 'active',
          summary: 'The crossings do not stay put.',
        },
      ],
    )
    expect(kind).toBe('background')
  })

  it('keeps a willful antagonist as a threat', () => {
    const kind = resolveNewThreadKind(
      { title: 'The Face Behind the Program', kind: 'threat', summary: 'Lena will burn him.' },
      [{ title: 'What the Sessions Are For', kind: 'mystery', status: 'active' }],
    )
    expect(kind).toBe('threat')
  })
})

describe('draftOpeningPlots', () => {
  it('emits 2–3 grounded threads with distinct Booker shapes', () => {
    const drafts = draftOpeningPlots({
      premise: 'A underground bunker with a small, friendly resident crew.',
      worldName: 'Project THRESHOLD',
      crew: [
        { name: 'Ellis Shaw', role: 'director' },
        { name: 'Jordan Lacy', role: 'steward' },
      ],
      relationships: [
        { fromRole: 'director', toRole: 'steward', kind: 'rival', valence: -0.4 },
      ],
      seed: 7,
    })
    expect(drafts.length).toBeGreaterThanOrEqual(2)
    expect(drafts.length).toBeLessThanOrEqual(3)
    expect(new Set(drafts.map((d) => d.plotShape)).size).toBe(drafts.length)
    expect(drafts.every((d) => !/overcoming the monster|the quest/i.test(d.title))).toBe(true)
    expect(drafts.some((d) => /clawing arm|tremor mapping/i.test(d.title))).toBe(false)
  })
})
