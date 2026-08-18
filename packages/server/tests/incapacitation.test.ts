import { describe, expect, it } from 'vitest'

import { resolveAgencyLock } from '@/domain/services/incapacitation'

describe('resolveAgencyLock', () => {
  it('detects a player-authored collapse this turn', () => {
    const s = resolveAgencyLock({
      playerText: 'The room fades into blackness as I lose consciousness.',
      recentAssistantText: 'Jordan smiles.',
    })
    expect(s.collapsingThisTurn).toBe(true)
    expect(s.restoreAgency).toBe(false)
    expect(s.locked).toBe(true)
  })

  it('restores agency after prose has them out and they yield', () => {
    const s = resolveAgencyLock({
      playerText: 'continue',
      recentAssistantText:
        "Blackness rushes in. Jordan’s hands catch your shoulder. “He’s out. Now.”",
    })
    expect(s.collapsingThisTurn).toBe(false)
    expect(s.restoreAgency).toBe(true)
  })

  it('treats bound/gagged as a lock, not a medical special case', () => {
    const s = resolveAgencyLock({
      playerText: 'continue',
      recentAssistantText: 'The rope holds. You are bound and gagged in the cellar.',
    })
    expect(s.locked).toBe(true)
    expect(s.restoreAgency).toBe(true)
  })

  it('honors stay-under without restoring agency', () => {
    const s = resolveAgencyLock({
      playerText: "I don't respond, and don't wake yet",
      recentAssistantText: 'Jordan waits over you.',
    })
    expect(s.stayUnder).toBe(true)
    expect(s.restoreAgency).toBe(false)
    expect(s.locked).toBe(true)
  })

  it('keeps the lock from persisted state when last prose dropped the keyword', () => {
    const s = resolveAgencyLock({
      playerText: 'continue',
      recentAssistantText: 'Jordan watches the monitor. The cycle starts again.',
      persistedLocked: true,
    })
    expect(s.locked).toBe(true)
    expect(s.restoreAgency).toBe(true)
  })

  it('treats fade out of consciousness as a collapse', () => {
    const s = resolveAgencyLock({
      playerText: 'I fade out of consciousness',
      recentAssistantText: 'Ellis leans in.',
    })
    expect(s.collapsingThisTurn).toBe(true)
    expect(s.locked).toBe(true)
  })

  it('does not treat a numb unresponsive limb as the protagonist being out', () => {
    const s = resolveAgencyLock({
      playerText: 'I stand up and look around',
      recentAssistantText:
        'The pulse leaves the limb heavy and unresponsive. The corridor remains empty.',
    })
    expect(s.locked).toBe(false)
  })

  it('does not lock an ordinary line', () => {
    const s = resolveAgencyLock({
      playerText: 'I look at Jordan',
      recentAssistantText: 'Jordan smiles and taps the monitor.',
    })
    expect(s.locked).toBe(false)
    expect(s.restoreAgency).toBe(false)
  })
})
