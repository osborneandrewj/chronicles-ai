import { describe, expect, it } from 'vitest'

import { formatNarratorTurnGuidance } from '@/lib/narrator-guidance'
import { isTransientServiceNpc } from '@/domain/services/npc-promotion'

// Genre-coupling audit, Phase 3: the narrator-guidance move detectors and the
// NPC-promotion transient-role filter were keyed on modern/sci-fi vocabulary, so
// period-appropriate actions silently no-opped. These assert the broadened
// (genre-inclusive, additive) term lists now fire for non-modern settings — the
// existing modern/sci-fi cases (e.g. "Vox, pattern match") remain covered in
// narrator-guidance.test.ts, so this only adds period coverage.

describe('narrator guidance fires for period vocabulary', () => {
  it('treats examining a ledger as an investigative move', () => {
    const guidance = formatNarratorTurnGuidance({
      stance: 'do',
      inputMode: 'in-character',
      playerText: "I examine the merchant's ledger for discrepancies",
      recentTurns: [],
      presentNpcCount: 0,
      plannedActionCount: 0,
      activeObjectiveTitles: ['Trace the missing grain'],
      openClueTitles: ['An altered tally mark'],
    })
    expect(guidance).toContain('concrete result')
    expect(guidance).toContain('new lead')
    expect(guidance).toContain('Trace the missing grain')
  })

  it('treats a sundial as a time-bearing device bound to the world clock', () => {
    const guidance = formatNarratorTurnGuidance({
      stance: 'observe',
      inputMode: 'in-character',
      playerText: 'I look at the sundial in the courtyard',
      recentTurns: [],
      presentNpcCount: 0,
      plannedActionCount: 0,
      worldTime: 'Day 3 — late afternoon',
    })
    expect(guidance).toContain('time-bearing device')
    expect(guidance).toContain('Day 3 — late afternoon')
    expect(guidance).toContain('authoritative world clock exactly')
  })

  it('treats a newspaper as a public-information surface', () => {
    const guidance = formatNarratorTurnGuidance({
      stance: 'observe',
      inputMode: 'in-character',
      playerText: 'I read the morning newspaper for word of the arrests',
      recentTurns: [],
      presentNpcCount: 0,
      plannedActionCount: 0,
    })
    expect(guidance).toContain('public information surface')
    expect(guidance).toContain('specific diegetic content')
  })

  it('treats toppling a temple colonnade as spectacle', () => {
    const guidance = formatNarratorTurnGuidance({
      stance: 'do',
      inputMode: 'in-character',
      playerText: "I shatter the temple's great columns one by one and watch them collapse.",
      recentTurns: [],
      presentNpcCount: 2,
      plannedActionCount: 0,
    })
    expect(guidance).toContain('This is spectacle')
    expect(guidance).toContain('unfold as a sequence')
  })
})

describe('transient-NPC filter recognizes period walk-on roles', () => {
  it('treats a peddler with no durable signal as a transient walk-on', () => {
    expect(
      isTransientServiceNpc({
        name: 'A travelling peddler',
        description: 'Hawks trinkets from a handcart, here today and gone tomorrow.',
        personal_goals: null,
        current_focus: null,
        active_goal: null,
      }),
    ).toBe(true)
  })

  it('keeps a period walk-on as a real character once a durable signal appears', () => {
    expect(
      isTransientServiceNpc({
        name: 'A travelling peddler',
        description: 'Hawks trinkets from a handcart.',
        personal_goals: 'Carries a secret message sewn into his coat lining.',
        current_focus: null,
        active_goal: null,
      }),
    ).toBe(false)
  })

  it('still treats a modern courier as transient (no regression)', () => {
    expect(
      isTransientServiceNpc({
        name: 'A bike courier',
        description: 'Drops a package and leaves.',
        personal_goals: null,
        current_focus: null,
        active_goal: null,
      }),
    ).toBe(true)
  })
})
