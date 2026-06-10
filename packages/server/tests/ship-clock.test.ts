import { describe, expect, it } from 'vitest'

import { minutesToShipTime, shipTimeToMinutes } from '@/domain/services/ship-clock'
import { worldTimeBand } from '@/domain/services/world-clock'

// The prose-driven ship-clock (starship P6). Minutes since a Day-1 00:00 baseline
// render to a narrative time-of-day phrase + a WorldTimeBand, and the phrase must
// round-trip through worldTimeBand() back to the SAME band (the living tick parses
// world_time). Pure + deterministic.

describe('minutesToShipTime', () => {
  it('renders Day 1 at the baseline (00:00) as late night', () => {
    const { worldTime, band } = minutesToShipTime(0)
    expect(worldTime).toBe('Day 1 — late night (~00:00)')
    expect(band).toBe('night')
  })

  it('rolls the day over every 1440 minutes', () => {
    // Day 3, 06:30 = 2*1440 + 6*60 + 30
    const minutes = 2 * 1440 + 6 * 60 + 30
    const { worldTime, band } = minutesToShipTime(minutes)
    expect(worldTime).toBe('Day 3 — early morning (~06:30)')
    expect(band).toBe('morning')
  })

  it('renders an afternoon hour with a midday band', () => {
    const { worldTime, band } = minutesToShipTime(15 * 60) // 15:00 day 1
    expect(worldTime).toBe('Day 1 — afternoon (~15:00)')
    expect(band).toBe('midday')
  })

  it('clamps negative input to the baseline', () => {
    const { worldTime } = minutesToShipTime(-100)
    expect(worldTime).toBe('Day 1 — late night (~00:00)')
  })

  it('round-trips every rendered phrase through worldTimeBand to the same band', () => {
    // Sweep one full day at 15-minute resolution: the rendered worldTime parsed
    // by the live-tick path (worldTimeBand) must yield the band we emitted.
    for (let minutes = 0; minutes < 1440; minutes += 15) {
      const { worldTime, band } = minutesToShipTime(minutes)
      expect(worldTimeBand(worldTime)).toBe(band)
    }
  })
})

describe('shipTimeToMinutes', () => {
  it('parses a Day N — phrase (~HH:MM) string back to minutes', () => {
    expect(shipTimeToMinutes('Day 3 — early morning (~06:30)')).toBe(
      2 * 1440 + 6 * 60 + 30,
    )
    expect(shipTimeToMinutes('Day 1 — late night (~00:00)')).toBe(0)
  })

  it('round-trips minutesToShipTime output back to the same minutes', () => {
    for (const minutes of [0, 90, 750, 1440, 3990, 7 * 1440 + 13 * 60]) {
      const { worldTime } = minutesToShipTime(minutes)
      expect(shipTimeToMinutes(worldTime)).toBe(minutes)
    }
  })

  it('falls back to Day 1 midday (12:00) when unparseable', () => {
    expect(shipTimeToMinutes(null)).toBe(12 * 60)
    expect(shipTimeToMinutes('dusk over the bay')).toBe(19 * 60) // evening anchor
  })

  it('reads a band keyword when no clock token is present', () => {
    // 'Day 2 — morning' (no ~HH:MM) → day 2, morning anchor hour 08:00
    expect(shipTimeToMinutes('Day 2 — morning')).toBe(1440 + 8 * 60)
  })
})
