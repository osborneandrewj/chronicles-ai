import { describe, expect, it } from 'vitest'

import {
  hasSalientIntrusion,
  summarizePlanSalience,
} from '@/domain/services/plan-salience'

describe('summarizePlanSalience', () => {
  it('treats console busywork as non-salient', () => {
    const summary = summarizePlanSalience([
      {
        npc_name: 'Officer A',
        intent: 'monitor channel',
        planned_action: 'keeps radio open, fingers on the console keys',
        intent_type: 'react',
      },
      {
        planned_action: 'types at the headset console, watches the feed',
      },
      {
        planned_action: 'scrolls the layered facility map on her terminal',
      },
    ] as never)

    expect(summary.salientCount).toBe(0)
    expect(summary.busyworkCount).toBe(3)
    expect(summary.advancesOpenOrder).toBe(false)
    expect(hasSalientIntrusion(summary)).toBe(false)
  })

  it('marks structured retrieve/escort/arrive/report intent_types salient', () => {
    const summary = summarizePlanSalience([
      {
        intent_type: 'retrieve',
        planned_action: 'sends units to find the subject',
        target_npc_name: 'Andy Osborne',
      },
    ])

    expect(summary.salientCount).toBe(1)
    expect(hasSalientIntrusion(summary)).toBe(true)
  })

  it('marks a plan that advances open order by target_npc_name', () => {
    const summary = summarizePlanSalience(
      [
        {
          intent_type: 'escort',
          planned_action: 'escorts the subject into the wing',
          target_npc_name: 'Andy Osborne',
        },
      ],
      { targetName: 'Andy Osborne', status: 'pending' },
    )

    expect(summary.advancesOpenOrder).toBe(true)
    expect(summary.salientCount).toBe(1)
    expect(hasSalientIntrusion(summary)).toBe(true)
  })

  it('prefers structured fields over prose (busywork prose + salient intent_type)', () => {
    const summary = summarizePlanSalience([
      {
        intent_type: 'report',
        planned_action: 'monitors the radio while reporting empty quarters',
      },
    ])

    expect(summary.salientCount).toBe(1)
  })

  it('treats arrival/report prose as salient even without intent_type', () => {
    const summary = summarizePlanSalience([
      {
        planned_action: 'Andy enters with an escort and reports to the desk',
      },
    ])

    expect(summary.salientCount).toBe(1)
  })

  it('does not let busywork alone advance an open order', () => {
    const summary = summarizePlanSalience(
      [
        {
          planned_action: 'keeps radio open, monitors channel',
          intent_type: 'react',
        },
      ],
      { targetName: 'Andy Osborne', status: 'pending' },
    )

    expect(summary.advancesOpenOrder).toBe(false)
    expect(summary.salientCount).toBe(0)
    expect(hasSalientIntrusion(summary)).toBe(false)
  })
})
