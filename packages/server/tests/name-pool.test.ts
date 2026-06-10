import { describe, expect, it } from 'vitest'

import { NAME_POOL, sample } from '@/domain/services/name-pool'

// Unit tests for the pure NamePool domain service (Phase A, A10).
// Verifies: determinism, exclude-list, tag-keyed sampling, and n-capping.

describe('sample — determinism', () => {
  it('returns the same output for the same seed and inputs', () => {
    const a = sample(['generic'], 5, { seed: 42 })
    const b = sample(['generic'], 5, { seed: 42 })
    expect(a).toEqual(b)
  })

  it('returns different output for different seeds', () => {
    const a = sample(['generic'], 5, { seed: 1 })
    const b = sample(['generic'], 5, { seed: 99999 })
    // It is astronomically unlikely these are identical — a collision would be a bug.
    expect(a).not.toEqual(b)
  })

  it('is stable across multiple calls with the same seed', () => {
    const first = sample(['sci-fi', 'space'], 4, { seed: 7 })
    for (let i = 0; i < 5; i++) {
      expect(sample(['sci-fi', 'space'], 4, { seed: 7 })).toEqual(first)
    }
  })
})

describe('sample — exclude list', () => {
  it('removes exact surname matches (case-insensitive)', () => {
    // Collect all possible surnames from generic pool, then exclude the first few.
    const genericBucket = NAME_POOL.find((b) => b.tags.includes('generic'))!
    const toExclude = genericBucket.surnames.slice(0, 5)

    // Request enough names to exercise the pool.
    const result = sample(['generic'], 20, { seed: 1, exclude: toExclude })
    const resultSurnames = result.map((r) => r.surname.toLowerCase())
    for (const excluded of toExclude) {
      expect(resultSurnames).not.toContain(excluded.toLowerCase())
    }
  })

  it('handles uppercase and mixed-case excludes', () => {
    const result = sample(['generic'], 20, { seed: 2, exclude: ['ADLER', 'Shaw'] })
    const surnames = result.map((r) => r.surname.toLowerCase())
    expect(surnames).not.toContain('adler')
    expect(surnames).not.toContain('shaw')
  })

  it('returns empty array when all surnames are excluded', () => {
    const genericBucket = NAME_POOL.find((b) => b.tags.includes('generic'))!
    const result = sample(['generic'], 10, { seed: 3, exclude: genericBucket.surnames })
    expect(result).toHaveLength(0)
  })
})

describe('sample — tag-keyed sampling', () => {
  it('returns roman-era names for the "roman" tag', () => {
    const romanBucket = NAME_POOL.find((b) => b.tags.includes('roman'))!
    const romanGiven = new Set(romanBucket.given)
    const romanSurnames = new Set(romanBucket.surnames)

    const result = sample(['roman'], 6, { seed: 10 })
    expect(result.length).toBeGreaterThan(0)
    for (const { given, surname } of result) {
      expect(romanGiven.has(given)).toBe(true)
      expect(romanSurnames.has(surname)).toBe(true)
    }
  })

  it('returns japanese names for the "japanese" tag', () => {
    const bucket = NAME_POOL.find((b) => b.tags.includes('japanese'))!
    const givenSet = new Set(bucket.given)
    const surnameSet = new Set(bucket.surnames)

    const result = sample(['japanese'], 5, { seed: 20 })
    expect(result.length).toBeGreaterThan(0)
    for (const { given, surname } of result) {
      expect(givenSet.has(given)).toBe(true)
      expect(surnameSet.has(surname)).toBe(true)
    }
  })

  it('returns norse names for the "viking" tag (alias of "norse")', () => {
    const bucket = NAME_POOL.find((b) => b.tags.includes('norse'))!
    const givenSet = new Set(bucket.given)
    const surnameSet = new Set(bucket.surnames)

    const result = sample(['viking'], 4, { seed: 30 })
    expect(result.length).toBeGreaterThan(0)
    for (const { given, surname } of result) {
      expect(givenSet.has(given)).toBe(true)
      expect(surnameSet.has(surname)).toBe(true)
    }
  })

  it('falls back to the generic bucket for an unknown tag', () => {
    const genericBucket = NAME_POOL.find((b) => b.tags.includes('generic'))!
    const givenSet = new Set(genericBucket.given)
    const surnameSet = new Set(genericBucket.surnames)

    const result = sample(['no-such-era-zzzz'], 5, { seed: 5 })
    expect(result.length).toBeGreaterThan(0)
    for (const { given, surname } of result) {
      expect(givenSet.has(given)).toBe(true)
      expect(surnameSet.has(surname)).toBe(true)
    }
  })

  it('unions buckets when multiple tags are provided', () => {
    // sci-fi + medieval-english → names from EITHER bucket are valid.
    const scifiBucket = NAME_POOL.find((b) => b.tags.includes('sci-fi'))!
    const medievalBucket = NAME_POOL.find((b) => b.tags.includes('medieval-english'))!
    const validGiven = new Set([...scifiBucket.given, ...medievalBucket.given])
    const validSurnames = new Set([...scifiBucket.surnames, ...medievalBucket.surnames])

    const result = sample(['sci-fi', 'medieval-english'], 10, { seed: 40 })
    expect(result.length).toBeGreaterThan(0)
    for (const { given, surname } of result) {
      expect(validGiven.has(given)).toBe(true)
      expect(validSurnames.has(surname)).toBe(true)
    }
  })
})

describe('sample — n and pool-size capping', () => {
  it('returns exactly n pairs when the pool is large enough', () => {
    const result = sample(['generic'], 5, { seed: 50 })
    expect(result).toHaveLength(5)
  })

  it('returns 0 pairs when n is 0', () => {
    expect(sample(['generic'], 0, { seed: 1 })).toHaveLength(0)
  })

  it('returns at most pool-size pairs when n exceeds the pool', () => {
    // roman bucket has ~22 given + ~20 surnames; asking for 999 should return ≤ min(given, surnames).
    const romanBucket = NAME_POOL.find((b) => b.tags.includes('roman'))!
    const maxPossible = Math.min(romanBucket.given.length, romanBucket.surnames.length)
    const result = sample(['roman'], 999, { seed: 1 })
    expect(result.length).toBeLessThanOrEqual(maxPossible)
    expect(result.length).toBeGreaterThan(0)
  })

  it('each pair has a non-empty given name and surname', () => {
    const result = sample(['norse'], 8, { seed: 99 })
    for (const { given, surname } of result) {
      expect(given.length).toBeGreaterThan(0)
      expect(surname.length).toBeGreaterThan(0)
    }
  })
})

describe('sample — Phase B era buckets', () => {
  it('returns greek names for the "greek" tag and at least one is in the bucket', () => {
    const bucket = NAME_POOL.find((b) => b.tags.includes('greek'))!
    const bucketGiven = new Set(bucket.given)

    const result = sample(['greek'], 5, { seed: 1 })
    expect(result.length).toBeGreaterThan(0)
    const hasGreekName = result.some(({ given }) => bucketGiven.has(given))
    expect(hasGreekName).toBe(true)
  })

  it('returns names from each new era bucket when sampled by primary tag', () => {
    const newTags = [
      'egyptian', 'mongol', 'italian', 'american', 'turkish',
      'chinese', 'spanish', 'nahua', 'caribbean', 'persian',
      'german', 'arabic', 'european',
    ]
    for (const tag of newTags) {
      const bucket = NAME_POOL.find((b) => b.tags.includes(tag))!
      expect(bucket, `missing bucket for tag "${tag}"`).toBeDefined()
      const givenSet = new Set(bucket.given)
      const result = sample([tag], 4, { seed: 7 })
      expect(result.length, `empty result for tag "${tag}"`).toBeGreaterThan(0)
      const allFromBucket = result.every(({ given }) => givenSet.has(given))
      expect(allFromBucket, `result for "${tag}" contains names outside its bucket`).toBe(true)
    }
  })

  it('still falls back to generic for a completely unknown tag after Phase B', () => {
    const genericBucket = NAME_POOL.find((b) => b.tags.includes('generic'))!
    const givenSet = new Set(genericBucket.given)
    const surnameSet = new Set(genericBucket.surnames)

    const result = sample(['no-such-era-phase-b-zzzz'], 5, { seed: 5 })
    expect(result.length).toBeGreaterThan(0)
    for (const { given, surname } of result) {
      expect(givenSet.has(given)).toBe(true)
      expect(surnameSet.has(surname)).toBe(true)
    }
  })
})
