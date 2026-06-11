import { describe, expect, it } from 'vitest'

import { tickToBand, tickToWorldTime } from '@/domain/services/sim-clock'

// Pure tick → world-clock mapping for the bounded-world pre-sim (P2). A tick is
// one WorldTimeBand; the four bands cycle and the in-world day rolls over every
// four ticks. (Colocated by convention under tests/, where the runner's include
// glob picks it up.)

describe('tickToBand', () => {
  it('starts at morning on tick 0', () => {
    expect(tickToBand(0)).toBe('morning')
  })

  it('cycles morning→midday→evening→night across the first four ticks', () => {
    expect(tickToBand(0)).toBe('morning')
    expect(tickToBand(1)).toBe('midday')
    expect(tickToBand(2)).toBe('evening')
    expect(tickToBand(3)).toBe('night')
  })

  it('wraps back to morning every four ticks', () => {
    expect(tickToBand(4)).toBe('morning')
    expect(tickToBand(8)).toBe('morning')
    expect(tickToBand(23)).toBe('night')
  })
})

describe('tickToWorldTime', () => {
  it('labels tick 0 as Day 1 — morning by default', () => {
    expect(tickToWorldTime(0)).toBe('Day 1 — morning')
  })

  it('rolls the day over at tick 4 and tick 8', () => {
    expect(tickToWorldTime(3)).toBe('Day 1 — night')
    expect(tickToWorldTime(4)).toBe('Day 2 — morning')
    expect(tickToWorldTime(7)).toBe('Day 2 — night')
    expect(tickToWorldTime(8)).toBe('Day 3 — morning')
  })

  it('respects a startDay offset', () => {
    expect(tickToWorldTime(0, 5)).toBe('Day 5 — morning')
    expect(tickToWorldTime(4, 5)).toBe('Day 6 — morning')
    expect(tickToWorldTime(5, 5)).toBe('Day 6 — midday')
  })
})
