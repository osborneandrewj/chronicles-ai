import { describe, expect, it } from 'vitest'

import { buildPerceptionPin } from '@/domain/services/perception-pin'
import { formatPerceptionPin } from '@/lib/world-state'

describe('buildPerceptionPin', () => {
  it('splits here vs elsewhere by presence, not by role', () => {
    const pin = buildPerceptionPin({
      placeName: 'Isolation Chamber',
      present: [
        { name: 'Andrew Osborne', isPlayer: true },
        { name: 'Ellis Shaw', isPlayer: false },
      ],
      known: [
        { name: 'Andrew Osborne', isPlayer: true, currentPlaceId: 14 },
        { name: 'Ellis Shaw', isPlayer: false, currentPlaceId: 14 },
        { name: 'Jordan Lacy', isPlayer: false, currentPlaceId: 12 },
        { name: 'Lee Ingram', isPlayer: false, currentPlaceId: 39 },
        { name: 'Lena Korr', isPlayer: false, currentPlaceId: 10 },
      ],
      placeNameById: new Map([
        [14, 'Isolation Chamber'],
        [12, 'Mess Hall'],
        [39, 'Medical'],
        [10, 'Blast Doors'],
      ]),
    })
    expect(pin.here).toEqual(['Ellis Shaw'])
    expect(pin.elsewhere.map((e) => e.name)).toEqual([
      'Jordan Lacy',
      'Lee Ingram',
      'Lena Korr',
    ])
    expect(pin.elsewhere.find((e) => e.name === 'Jordan Lacy')?.place).toBe('Mess Hall')
  })
})

describe('formatPerceptionPin', () => {
  it('pins HERE/ELSEWHERE as binding', () => {
    const block = formatPerceptionPin({
      placeName: 'Isolation Chamber',
      here: ['Ellis Shaw'],
      elsewhere: [
        { name: 'Jordan Lacy', place: 'Mess Hall' },
        { name: 'Lee Ingram', place: 'Medical' },
      ],
    })
    expect(block).toContain('### PERCEPTION (authoritative)')
    expect(block).toContain('HERE (can hear/see/speak here): Ellis Shaw')
    expect(block).toContain('Jordan Lacy — Mess Hall')
    expect(block).toMatch(/not on camera/i)
    expect(block).toMatch(/do not describe them or their room/i)
    expect(block).toMatch(/no voice from a doorway/i)
    expect(block).toMatch(/do not share a plot file/i)
  })
})
