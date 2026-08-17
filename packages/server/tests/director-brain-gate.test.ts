import { describe, expect, it } from 'vitest'

import {
  DIRECTOR_BRAIN_COOLDOWN_TURNS,
  shouldRunDirectorBrain,
} from '@/domain/services/director-brain-gate'

const base = {
  pendingUnused: false,
  lastBrainTurnId: null as number | null,
  currentTurnId: 20,
  beatKind: 'pressure' as const,
  phase: 'rising' as const,
  activeThreadCount: 1,
  activeObjectiveCount: 1,
  cast: [{ characterId: 1, name: 'Marcus', role: 'initiate' as const }],
  presentNpcCount: 1,
}

describe('shouldRunDirectorBrain', () => {
  it('skips when a pending beat is unused', () => {
    expect(shouldRunDirectorBrain({ ...base, pendingUnused: true, beatKind: 'stall_escalate' })).toBeNull()
  })

  it('fires empty_dossier first', () => {
    expect(
      shouldRunDirectorBrain({
        ...base,
        activeThreadCount: 0,
        activeObjectiveCount: 0,
        beatKind: 'stall_escalate',
      }),
    ).toBe('empty_dossier')
  })

  it('fires stall and climax', () => {
    expect(shouldRunDirectorBrain({ ...base, beatKind: 'stall_escalate' })).toBe('stall')
    expect(shouldRunDirectorBrain({ ...base, phase: 'climax' })).toBe('climax')
  })

  it('fires cast_collision when many present and no single initiator', () => {
    expect(
      shouldRunDirectorBrain({
        ...base,
        presentNpcCount: 3,
        cast: [
          { characterId: 1, name: 'A', role: 'react' },
          { characterId: 2, name: 'B', role: 'react' },
        ],
      }),
    ).toBe('cast_collision')
  })

  it('respects cooldown except for empty dossier', () => {
    expect(
      shouldRunDirectorBrain({
        ...base,
        beatKind: 'stall_escalate',
        lastBrainTurnId: 20 - DIRECTOR_BRAIN_COOLDOWN_TURNS + 1,
      }),
    ).toBeNull()
    expect(
      shouldRunDirectorBrain({
        ...base,
        activeThreadCount: 0,
        activeObjectiveCount: 0,
        lastBrainTurnId: 19,
      }),
    ).toBe('empty_dossier')
  })
})
