import { describe, expect, it } from 'vitest'

import {
  antagonistSpeechRegister,
  DEFAULT_ANTAGONIST_SPEECH_REGISTER,
  defaultSpeechHint,
  finalizeTalkPlan,
  isTalkShapedPlan,
  sanitizePlannedAction,
  sanitizeSpeechHint,
  stubSpeechRegisterForRole,
} from '@/domain/services/speech-staging'

describe('sanitizePlannedAction', () => {
  it('keeps a physical move with no dialogue', () => {
    expect(sanitizePlannedAction('turns his chair to face Andrew')).toBe(
      'turns his chair to face Andrew',
    )
  })

  it('strips a colon-then-quoted script', () => {
    const raw =
      "stops walking and turns to face Andrew, one hand gesturing back toward the bunk: 'Latest is you're on rest until the clinic files land.'"
    const out = sanitizePlannedAction(raw)
    expect(out.toLowerCase()).toContain('turns to face andrew')
    expect(out).not.toMatch(/latest is/i)
    expect(out).not.toContain("'")
  })

  it('strips a double-quoted line after a speech verb', () => {
    const raw =
      'steps closer and drops his voice to one sentence: "You heard the order. Quarters or escorted corridor."'
    const out = sanitizePlannedAction(raw)
    expect(out).toContain('steps closer')
    expect(out).not.toMatch(/you heard the order/i)
  })

  it('cuts a post-colon content dump after a speech verb', () => {
    const raw =
      'pauses, then speaks with clinical precision: lays out localized motor lockdown, independent of the grid, no structural damage'
    const out = sanitizePlannedAction(raw)
    expect(out.toLowerCase()).toContain('speaks with clinical precision')
    expect(out).not.toMatch(/localized motor lockdown/i)
  })

  it('keeps "asks X" as a decision when no script follows', () => {
    const out = sanitizePlannedAction(
      'steps closer and asks Andrew his name and what day it is',
    )
    expect(out).toContain('asks Andrew his name')
  })

  it('returns a fallback for empty input', () => {
    expect(sanitizePlannedAction('')).toBe('acts without speaking')
    expect(sanitizePlannedAction('   ')).toBe('acts without speaking')
  })
})

describe('isTalkShapedPlan', () => {
  it('treats confront / question / inform intent types as talk', () => {
    expect(
      isTalkShapedPlan({
        planned_action: 'turns to face him',
        intent_type: 'confront',
      }),
    ).toBe(true)
    expect(
      isTalkShapedPlan({
        planned_action: 'sets the cuff down',
        intent_type: 'inform',
      }),
    ).toBe(true)
  })

  it('detects speech verbs in the move even without intent_type', () => {
    expect(
      isTalkShapedPlan({
        planned_action: 'asks Andrew what he saw',
      }),
    ).toBe(true)
  })

  it('does not treat a silent leave as talk', () => {
    expect(
      isTalkShapedPlan({
        planned_action: 'walks out without a word',
        intent: 'leave',
        intent_type: 'leave',
      }),
    ).toBe(false)
  })
})

describe('finalizeTalkPlan', () => {
  it('fills a default speech_hint on talk plans that omitted one', () => {
    const out = finalizeTalkPlan(
      {
        planned_action: 'turns his chair to face Andrew',
        intent_type: 'confront',
      },
      'clipped · formal · default: counter-question · never monologues',
    )
    expect(out.speech_hint).toMatch(/counter-question/i)
    expect(out.speech_hint).toMatch(/not a one-liner|add a clause/i)
  })

  it('keeps an authored speech_hint and still strips the script', () => {
    const out = finalizeTalkPlan(
      {
        planned_action:
          'leans in: "State your name. State the day. State where you are."',
        intent_type: 'investigate',
        speech_hint: 'one hard question; no softener',
      },
      null,
    )
    expect(out.planned_action).not.toMatch(/state your name/i)
    expect(out.speech_hint).toBe('one hard question; no softener')
  })

  it('does not invent a hint for a silent leave', () => {
    const out = finalizeTalkPlan(
      { planned_action: 'walks out without a word', intent_type: 'leave' },
      null,
    )
    expect(out.speech_hint).toBeNull()
  })
})

describe('sanitizeSpeechHint', () => {
  it('caps and strips long quoted monologues', () => {
    expect(sanitizeSpeechHint('cuts off; one question')).toBe('cuts off; one question')
    expect(sanitizeSpeechHint(null)).toBeNull()
    const dumped =
      'says "This is a very long monologue that the model should not dump into a staging edge field at all, really."'
    const out = sanitizeSpeechHint(dumped)
    expect(out == null || !out.includes('very long monologue')).toBe(true)
    expect(sanitizeSpeechHint('x'.repeat(200))?.length).toBe(160)
  })
})

describe('register helpers', () => {
  it('falls back to the antagonist house register', () => {
    expect(antagonistSpeechRegister(null)).toBe(DEFAULT_ANTAGONIST_SPEECH_REGISTER)
    expect(antagonistSpeechRegister('  clipped · cold  ')).toBe('clipped · cold')
  })

  it('gives stub roles distinct registers', () => {
    const captain = stubSpeechRegisterForRole('captain')
    const cook = stubSpeechRegisterForRole('cook')
    expect(captain).not.toBe(cook)
    expect(captain).toMatch(/direct instruction/)
    expect(cook).toMatch(/gentle question/)
  })

  it('defaultSpeechHint reads default move from a register and asks for more than a one-liner', () => {
    const hint = defaultSpeechHint('warm · default: gentle question · never pushy')
    expect(hint).toMatch(/gentle question/i)
    expect(hint).toMatch(/not a one-liner|add a clause/i)
  })
})
