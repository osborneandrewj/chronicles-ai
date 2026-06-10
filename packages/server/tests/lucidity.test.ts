import { describe, expect, it } from 'vitest'

import { MAX_LUCIDITY, lucidityDelta, lucidityStage } from '@/domain/services/lucidity'

describe('lucidityDelta', () => {
  it('ticks up on a discovery / rule-violation beat', () => {
    expect(lucidityDelta('I focus and the world bends', '', 0)).toBe(1)
    expect(lucidityDelta('', 'Time slows around you as you concentrate.', 1)).toBe(1)
    expect(lucidityDelta('', 'A glitch ripples across the wall.', 0)).toBe(1)
    expect(lucidityDelta('', 'None of this is real, you realize.', 2)).toBe(1)
  })

  it('does not tick on ordinary action', () => {
    expect(lucidityDelta('I draw my sword and charge', 'Steel meets steel.', 0)).toBe(0)
    expect(lucidityDelta('I talk to the captain', 'She nods.', 1)).toBe(0)
  })

  it('stops at the cap', () => {
    expect(lucidityDelta('the world bends', '', MAX_LUCIDITY)).toBe(0)
  })
})

describe('lucidityStage', () => {
  it('progresses fixed -> cracks -> affordances', () => {
    expect(lucidityStage(0)).toBe('fixed')
    expect(lucidityStage(1)).toBe('fixed')
    expect(lucidityStage(2)).toBe('cracks')
    expect(lucidityStage(3)).toBe('cracks')
    expect(lucidityStage(4)).toBe('affordances')
    expect(lucidityStage(5)).toBe('affordances')
  })
})
