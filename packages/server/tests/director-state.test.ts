import { describe, expect, it } from 'vitest'

import { emptyDirectorState } from '@/domain/entities/director-state'
import { parseDirectorState, serializeDirectorState } from '@/domain/services/director-state'

describe('parseDirectorState', () => {
  it('returns empty on null or garbage', () => {
    expect(parseDirectorState(null)).toEqual(emptyDirectorState())
    expect(parseDirectorState('not-json')).toEqual(emptyDirectorState())
  })

  it('round-trips a pending beat', () => {
    const state = {
      pending: {
        beatKind: 'pressure' as const,
        foregroundThreadId: 7,
        mustStage: ['Stage the letter'],
        mustNot: ['Do not open a new major arc this turn.'],
        cast: [{ characterId: 2, name: 'Setnakht', role: 'initiate' as const }],
        guidanceLines: ['Keep it tight'],
        reason: 'stall' as const,
        sourceTurnId: 11,
      },
      lastBrainTurnId: 11,
      lastBrainReason: 'stall' as const,
    }
    expect(parseDirectorState(serializeDirectorState(state))).toEqual(state)
  })
})
