import { describe, expect, it } from 'vitest'

import {
  repeatedSpokenLineCue,
  repeatedStagedPlanCue,
} from '@/domain/services/repeated-npc-beat'

describe('repeatedStagedPlanCue', () => {
  it('fires when the same presence-support plan already landed twice', () => {
    const cue = repeatedStagedPlanCue([
      {
        planned_action: 'keeps her hand on the ledge and does not turn away from the glass',
        narrator_disposition: 'staged',
        intent_type: 'support',
      },
      {
        planned_action: 'places her palm flat against the observation window and holds his eyes',
        narrator_disposition: 'modified',
        intent_type: 'support',
      },
    ])
    expect(cue).toMatch(/PLAN LOOP/)
    expect(cue).toMatch(/I'm here/)
  })

  it('does not fire on a single staged plan', () => {
    expect(
      repeatedStagedPlanCue([
        {
          planned_action: 'places her palm on the glass',
          narrator_disposition: 'staged',
          intent_type: 'support',
        },
      ]),
    ).toBeNull()
  })

  it('does not fire on two different non-presence plans', () => {
    expect(
      repeatedStagedPlanCue([
        {
          planned_action: 'walks to the mess and sits across from him',
          narrator_disposition: 'staged',
          intent_type: 'support',
        },
        {
          planned_action: 'asks Ellis what Lena ordered in the ledger',
          narrator_disposition: 'staged',
          intent_type: 'investigate',
        },
      ]),
    ).toBeNull()
  })
})

describe('repeatedSpokenLineCue', () => {
  it('fires when two recent turns reuse I\'m here / I\'m still here', () => {
    const cue = repeatedSpokenLineCue([
      'Jordan presses her palm to the glass. “I’m here,” she says, voice low.',
      'Ellis logs the interval.',
      'Jordan glances at him. “I’m still right here.”',
    ])
    expect(cue).toMatch(/Do not reuse/)
    expect(cue!.toLowerCase()).toMatch(/here/)
  })

  it('does not fire on a one-off comfort line', () => {
    expect(
      repeatedSpokenLineCue([
        'Jordan sits down. “I’m here if you need anything.”',
        'Ellis recites the numbers and closes the ledger.',
      ]),
    ).toBeNull()
  })
})
