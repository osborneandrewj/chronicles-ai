import { describe, expect, it } from 'vitest'

import { coLocatedGroups, groupByPlace } from '@/domain/services/colocation'

describe('groupByPlace', () => {
  it('groups characters by place in stable order', () => {
    const groups = groupByPlace([
      { characterId: 1, placeId: 10 },
      { characterId: 2, placeId: 20 },
      { characterId: 3, placeId: 10 },
    ])
    expect(groups).toEqual([
      { placeId: 10, characterIds: [1, 3] },
      { placeId: 20, characterIds: [2] },
    ])
  })

  it('ignores positions with a null place', () => {
    const groups = groupByPlace([
      { characterId: 1, placeId: 10 },
      { characterId: 2, placeId: null },
      { characterId: 3, placeId: 10 },
    ])
    expect(groups).toEqual([{ placeId: 10, characterIds: [1, 3] }])
  })

  it('returns an empty array when every place is null', () => {
    expect(
      groupByPlace([
        { characterId: 1, placeId: null },
        { characterId: 2, placeId: null },
      ]),
    ).toEqual([])
  })

  it('keeps singletons as their own group', () => {
    const groups = groupByPlace([
      { characterId: 1, placeId: 10 },
      { characterId: 2, placeId: 20 },
    ])
    expect(groups).toEqual([
      { placeId: 10, characterIds: [1] },
      { placeId: 20, characterIds: [2] },
    ])
  })
})

describe('coLocatedGroups', () => {
  it('excludes singletons, keeping only groups of two or more', () => {
    const groups = coLocatedGroups([
      { characterId: 1, placeId: 10 },
      { characterId: 2, placeId: 20 },
      { characterId: 3, placeId: 10 },
      { characterId: 4, placeId: 30 },
      { characterId: 5, placeId: 30 },
    ])
    expect(groups).toEqual([
      { placeId: 10, characterIds: [1, 3] },
      { placeId: 30, characterIds: [4, 5] },
    ])
  })

  it('ignores null places when computing co-location', () => {
    const groups = coLocatedGroups([
      { characterId: 1, placeId: 10 },
      { characterId: 2, placeId: null },
      { characterId: 3, placeId: 10 },
      { characterId: 4, placeId: null },
    ])
    expect(groups).toEqual([{ placeId: 10, characterIds: [1, 3] }])
  })

  it('returns an empty array when no two characters share a place', () => {
    expect(
      coLocatedGroups([
        { characterId: 1, placeId: 10 },
        { characterId: 2, placeId: 20 },
      ]),
    ).toEqual([])
  })
})
