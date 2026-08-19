import { describe, expect, it } from 'vitest'

import { getPark, PARK_CATALOG } from '@/domain/services/park-catalog'

describe('park catalog', () => {
  it('leads with Project THRESHOLD', () => {
    expect(PARK_CATALOG.length).toBeGreaterThan(0)
    expect(PARK_CATALOG[0].id).toBe('threshold')
    expect(PARK_CATALOG[0].name).toBe('Project THRESHOLD')
    expect(PARK_CATALOG[0].hasFacility).toBe(true)
    expect(PARK_CATALOG[0].templateId).toBe('bunker')
  })

  it('does not ship HBO marks in player-facing copy', () => {
    const banned = /westworld|delos|these violent delights/i
    for (const park of PARK_CATALOG) {
      expect(park.name).not.toMatch(banned)
      expect(park.promise).not.toMatch(banned)
      expect(park.premise).not.toMatch(banned)
      expect(park.era).not.toMatch(banned)
    }
  })

  it('looks up a park by id and ignores unknown ids', () => {
    expect(getPark('threshold')?.name).toBe('Project THRESHOLD')
    expect(getPark('westworld')).toBeUndefined()
    expect(getPark('')).toBeUndefined()
  })
})
