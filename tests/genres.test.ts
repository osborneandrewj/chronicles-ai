import { describe, expect, it } from 'vitest'

import { GENRES, isGenre } from '@/lib/genres'

describe('genres allowlist', () => {
  it('exposes a non-empty, de-duplicated list', () => {
    expect(GENRES.length).toBeGreaterThan(0)
    expect(new Set(GENRES).size).toBe(GENRES.length)
  })

  it('isGenre accepts listed genres and rejects others', () => {
    expect(isGenre(GENRES[0])).toBe(true)
    expect(isGenre('Not A Real Genre')).toBe(false)
    expect(isGenre('')).toBe(false)
  })
})
