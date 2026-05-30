import { describe, expect, it } from 'vitest'

import { GeneratedWorldSchema } from '@/lib/world-generator'

describe('GeneratedWorldSchema', () => {
  it('accepts a fully-formed generated world', () => {
    const parsed = GeneratedWorldSchema.safeParse({
      name: 'The Drowned Court',
      premise:
        'In a flooded city of brass and barnacles, a tide-priest hunts the heir who vanished beneath the waterline.',
      location: 'The Salt Cathedral, ankle-deep at low tide',
      time: 'Day 1, the turning of the tide',
      identity: 'A wary diver new to the city, lantern in hand.',
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects an object missing required fields', () => {
    const parsed = GeneratedWorldSchema.safeParse({ name: 'X' })
    expect(parsed.success).toBe(false)
  })
})
