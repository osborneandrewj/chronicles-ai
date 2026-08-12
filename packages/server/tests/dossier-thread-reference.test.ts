import { describe, expect, it } from 'vitest'

import {
  isClosedThreadStatus,
  resolveThreadReference,
} from '@/domain/services/dossier-thread-reference'

describe('resolveThreadReference', () => {
  it('creates an active mystery when missing and preferQuest is false', () => {
    expect(resolveThreadReference(null)).toEqual({
      action: 'create',
      kind: 'mystery',
      status: 'active',
    })
  })

  it('creates an active quest when missing and preferQuest is true', () => {
    expect(resolveThreadReference(null, { preferQuest: true })).toEqual({
      action: 'create',
      kind: 'quest',
      status: 'active',
    })
  })

  it('links without lifecycle change for closed threads', () => {
    for (const status of ['resolved', 'failed', 'dormant'] as const) {
      expect(
        resolveThreadReference(
          { id: 7, kind: 'quest', status },
          { preferQuest: true },
        ),
      ).toEqual({ action: 'link', id: 7, upgradeKindToQuest: false })
    }
  })

  it('upgrades active mystery/background to quest when preferQuest', () => {
    expect(
      resolveThreadReference(
        { id: 3, kind: 'mystery', status: 'active' },
        { preferQuest: true },
      ),
    ).toEqual({ action: 'link', id: 3, upgradeKindToQuest: true })

    expect(
      resolveThreadReference(
        { id: 4, kind: 'background', status: 'active' },
        { preferQuest: true },
      ),
    ).toEqual({ action: 'link', id: 4, upgradeKindToQuest: true })
  })

  it('does not upgrade threat or relationship kinds', () => {
    expect(
      resolveThreadReference(
        { id: 5, kind: 'threat', status: 'active' },
        { preferQuest: true },
      ),
    ).toEqual({ action: 'link', id: 5, upgradeKindToQuest: false })
  })

  it('does not upgrade soft kinds when the thread is not active', () => {
    expect(
      resolveThreadReference(
        { id: 6, kind: 'mystery', status: 'resolved' },
        { preferQuest: true },
      ),
    ).toEqual({ action: 'link', id: 6, upgradeKindToQuest: false })
  })
})

describe('isClosedThreadStatus', () => {
  it('recognizes resolved, failed, and dormant', () => {
    expect(isClosedThreadStatus('resolved')).toBe(true)
    expect(isClosedThreadStatus('failed')).toBe(true)
    expect(isClosedThreadStatus('dormant')).toBe(true)
    expect(isClosedThreadStatus('active')).toBe(false)
  })
})
