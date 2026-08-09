import { describe, expect, it } from 'vitest'

import { shouldEscalateViolence } from '@/domain/services/violence-escalation'

describe('shouldEscalateViolence', () => {
  it('suggests threat + timeline for public multi-kill in a civic place', () => {
    const result = shouldEscalateViolence({
      narration:
        'The older senator falls. The guards lie dead on the packed earth of the Agora. Bodies cool in the sun.',
      placeName: 'The Agora',
      presentNpcNames: ['The Silver-Haired Woman'],
    })
    expect(result.threat).not.toBeNull()
    expect(result.threat?.kind).toBe('threat')
    expect(result.threat?.status).toBe('active')
    expect(result.timelineEvent).not.toBeNull()
    expect(result.timelineEvent!.importance).toBeGreaterThanOrEqual(4)
  })

  it('suggests power-cost threat on superhuman grant language', () => {
    const result = shouldEscalateViolence({
      narration: 'With superhuman strength you hurl the marble bench aside.',
      isPowerGrant: true,
      placeName: 'Athens street',
    })
    expect(result.threat?.title).toMatch(/unnatural|rumor/i)
    expect(result.timelineEvent?.importance).toBeGreaterThanOrEqual(4)
  })

  it('only suggests a resource for an actual carried mark/object', () => {
    const withMark = shouldEscalateViolence({
      narration:
        'You kill the guard in the Agora. Your blood-stained cloak sticks to your shoulders.',
      placeName: 'Agora',
    })
    expect(withMark.resource?.held_by_name).toBe('protagonist')
    expect(withMark.resource?.name).toMatch(/blood/i)

    const noMark = shouldEscalateViolence({
      narration: 'You kill the guard in the Agora and walk away clean.',
      placeName: 'Agora',
    })
    expect(noMark.threat).not.toBeNull()
    expect(noMark.resource).toBeNull()
  })

  it('returns no escalation for a quiet non-violent beat', () => {
    const result = shouldEscalateViolence({
      narration: 'You nod and buy a loaf of bread at the stall.',
      placeName: 'Market lane',
    })
    expect(result.threat).toBeNull()
    expect(result.timelineEvent).toBeNull()
    expect(result.resource).toBeNull()
  })
})
