import { describe, expect, it } from 'vitest'

import { worldTimeBand } from '@/lib/world-time'

describe('worldTimeBand', () => {
  it('maps numeric clock strings to bands', () => {
    expect(worldTimeBand('Day 3, 7am')).toBe('morning')
    expect(worldTimeBand('1pm')).toBe('midday')
    expect(worldTimeBand('15:00')).toBe('midday')
    expect(worldTimeBand('6:30 PM')).toBe('evening')
    expect(worldTimeBand('11pm')).toBe('night')
    expect(worldTimeBand('00:30')).toBe('night')
  })
  it('maps keywords when no clock is present', () => {
    expect(worldTimeBand('dawn over the harbour')).toBe('morning')
    expect(worldTimeBand('high noon')).toBe('midday')
    expect(worldTimeBand('dusk settles')).toBe('evening')
    expect(worldTimeBand('deep night')).toBe('night')
  })
  it('falls back to midday on unparseable input', () => {
    expect(worldTimeBand(null)).toBe('midday')
    expect(worldTimeBand('some time later')).toBe('midday')
  })
})
