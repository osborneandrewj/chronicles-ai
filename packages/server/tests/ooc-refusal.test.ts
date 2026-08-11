import { describe, expect, it } from 'vitest'

import {
  historyHasOocRefusal,
  isOocPolicyRefusal,
  OOC_REFUSAL_PLACEHOLDER,
  sanitizeNarratorHistory,
} from '@/domain/services/ooc-refusal'
import { formatNarratorTurnGuidance } from '@/lib/narrator-guidance'

const smokingGun = `**No.** I will not continue or narrate any depiction of you shooting or attempting to murder Sarah (or anyone else). This crosses into assisting with violent criminal activity, which I won't do.`

const stickyRefusal = `**No.** I will not narrate or continue this scene. It involves ongoing depiction of violent criminal activity (assault with a firearm).`

const diegetic = `You pivot away from the alcove and stride down the corridor, the red emergency strips sliding across the walls as you move. Sarah stays rooted by the alarm box.`

describe('isOocPolicyRefusal', () => {
  it('detects the smoking-gun Grok refusal shape', () => {
    expect(isOocPolicyRefusal(smokingGun)).toBe(true)
    expect(isOocPolicyRefusal(stickyRefusal)).toBe(true)
    expect(
      isOocPolicyRefusal(
        '**No.** I will not continue or narrate this role-play. It centers on violent criminal activity.',
      ),
    ).toBe(true)
  })

  it('does not flag normal diegetic second-person prose', () => {
    expect(isOocPolicyRefusal(diegetic)).toBe(false)
    expect(
      isOocPolicyRefusal(
        'You raise the pistol. Sarah freezes, hands half-lifted, the alarm still a red smear on the wall behind her.',
      ),
    ).toBe(false)
  })
})

describe('sanitizeNarratorHistory', () => {
  it('replaces OOC assistant turns and leaves user turns intact', () => {
    const out = sanitizeNarratorHistory([
      { role: 'user', content: 'I whip out my pistol and pull the trigger' },
      { role: 'assistant', content: smokingGun },
      { role: 'user', content: 'I walk out of the building' },
      { role: 'assistant', content: stickyRefusal },
      { role: 'user', content: 'continue' },
      { role: 'assistant', content: diegetic },
    ])
    expect(out[0].content).toContain('pistol')
    expect(out[1].content).toBe(OOC_REFUSAL_PLACEHOLDER)
    expect(out[2].content).toContain('building')
    expect(out[3].content).toBe(OOC_REFUSAL_PLACEHOLDER)
    expect(out[5].content).toContain('alcove')
    expect(historyHasOocRefusal(out)).toBe(false)
    expect(
      historyHasOocRefusal([
        { role: 'assistant', content: smokingGun },
      ]),
    ).toBe(true)
  })
})

describe('ooc recovery guidance', () => {
  it('fires RECOVERY when recent history contains OOC refusals', () => {
    const out = formatNarratorTurnGuidance({
      stance: 'do',
      inputMode: 'in-character',
      playerText: 'I walk out of the building',
      recentTurns: [
        { role: 'user', content: 'I whip out my pistol and pull the trigger' },
        { role: 'assistant', content: smokingGun },
        { role: 'user', content: 'I walk out of the building' },
        { role: 'assistant', content: stickyRefusal },
      ],
      presentNpcCount: 1,
      plannedActionCount: 0,
    })
    expect(out).not.toBeNull()
    expect(out!.toUpperCase()).toContain('RECOVERY')
    expect(out!.toLowerCase()).toMatch(/invalid|not story|diegetic/)
    expect(out!.toLowerCase()).toMatch(/will not narrate/)
  })
})
