import { describe, expect, it } from 'vitest'

import { activityForBand, parseDailyLoop } from '@/lib/daily-loop'

describe('parseDailyLoop', () => {
  it('parses a valid loop and ignores junk', () => {
    const loop = parseDailyLoop('{"morning":{"activity":"opens the shop","place":"Anchor"}}')
    expect(loop?.morning?.activity).toBe('opens the shop')
    expect(parseDailyLoop('not json')).toBeNull()
    expect(parseDailyLoop(null)).toBeNull()
  })
})

describe('activityForBand', () => {
  it('returns the band entry or null', () => {
    const loop = parseDailyLoop('{"night":{"activity":"drinks late"}}')
    expect(activityForBand(loop, 'night')?.activity).toBe('drinks late')
    expect(activityForBand(loop, 'morning')).toBeNull()
    expect(activityForBand(null, 'night')).toBeNull()
  })
})
