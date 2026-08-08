import { describe, expect, it } from 'vitest'

import {
  eraFromGenreTags,
  parseGenreTags,
  trafficBlock,
  type InferredProfile,
} from '@/domain/services/occupancy-sim'

// Genre-coupling audit, Phase 4: a per-world genre signal (genre_tags) drives
// deterministic, era-appropriate behavior. These cover the pure helpers and the
// one consumer wired so far (era-gated occupancy traffic language).

const roadProfile: InferredProfile = {
  profileKind: 'road',
  capacityMin: 0,
  capacityMax: 6,
  typicalRoles: ['drivers', 'pedestrians'],
  trafficLevel: 'medium',
  matchTags: ['road'],
  hasTraffic: true,
}

describe('parseGenreTags', () => {
  it('parses a JSON string array', () => {
    expect(parseGenreTags('["roman","ancient"]')).toEqual(['roman', 'ancient'])
  })

  it('returns null for null, malformed, or non-array values', () => {
    expect(parseGenreTags(null)).toBeNull()
    expect(parseGenreTags('not json')).toBeNull()
    expect(parseGenreTags('{"a":1}')).toBeNull()
  })

  it('keeps only string entries', () => {
    expect(parseGenreTags('["roman", 7, null, "latin"]')).toEqual(['roman', 'latin'])
  })
})

describe('eraFromGenreTags', () => {
  it('maps clearly pre-automobile tags to premodern', () => {
    expect(eraFromGenreTags(['roman', 'ancient', 'political'])).toBe('premodern')
    expect(eraFromGenreTags(['medieval-english', 'intrigue'])).toBe('premodern')
  })

  it('defaults to modern for modern tags or no signal (never regresses)', () => {
    expect(eraFromGenreTags(['american'])).toBe('modern')
    expect(eraFromGenreTags(['german', 'espionage'])).toBe('modern')
    expect(eraFromGenreTags(null)).toBe('modern')
    expect(eraFromGenreTags([])).toBe('modern')
  })
})

describe('trafficBlock era-gating', () => {
  it('emits automobile-era motion by default (byte-identical to prior behavior)', () => {
    expect(trafficBlock(roadProfile, 'packed')?.notable_motion).toBe('gridlock and idling engines')
  })

  it('emits pre-automobile motion for a premodern world', () => {
    const motion = trafficBlock(roadProfile, 'packed', 'premodern')?.notable_motion
    expect(motion).toContain('carts')
  })

  it('still returns null when the profile has no traffic', () => {
    expect(trafficBlock({ ...roadProfile, hasTraffic: false }, 'packed', 'premodern')).toBeNull()
  })
})
