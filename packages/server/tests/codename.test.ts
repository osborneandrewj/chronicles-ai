import { describe, expect, it } from 'vitest'

import { generateCodename } from '@/domain/services/codename'

const GENRE_TOKENS = [
  'rome',
  'roman',
  'egypt',
  'viking',
  'norse',
  'samurai',
  'japan',
  'napoleon',
  'crusade',
  'mongol',
  'pirate',
  'ship',
  'vessel',
  'scout',
  'simulation',
  'hub',
  'matrix',
]

describe('generateCodename', () => {
  it('is deterministic under the same seed', () => {
    expect(generateCodename(42)).toBe(generateCodename(42))
    expect(generateCodename(1001)).toBe(generateCodename(1001))
  })

  it('produces different codenames for different seeds (mostly)', () => {
    const names = new Set(Array.from({ length: 50 }, (_, i) => generateCodename(i + 1)))
    // Allow a few collisions but expect broad variety.
    expect(names.size).toBeGreaterThan(30)
  })

  it('matches the opaque designator grammar', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const name = generateCodename(seed)
      // "<Prefix> 457" | "<Prefix> Theta-9" | "<Prefix> Vesper"
      expect(name).toMatch(/^[A-Z][a-z]+ (?:\d{3}|[A-Z][a-z]+-\d{1,2}|[A-Z][a-z]+)$/)
    }
  })

  it('never encodes the genre or the simulation frame', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const lower = generateCodename(seed).toLowerCase()
      for (const token of GENRE_TOKENS) {
        expect(lower).not.toContain(token)
      }
    }
  })
})
