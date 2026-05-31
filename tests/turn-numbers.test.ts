import { describe, expect, it } from 'vitest'

import { buildTurnNumberMap } from '@/lib/turn-numbers'

describe('buildTurnNumberMap', () => {
  it('maps the first id to 1 regardless of how large the global id is', () => {
    const map = buildTurnNumberMap([910, 911, 912])
    expect(map).toEqual({ 910: 1, 911: 2, 912: 3 })
  })

  it('preserves the given order (does not re-sort)', () => {
    const map = buildTurnNumberMap([5, 4, 9])
    expect(map).toEqual({ 5: 1, 4: 2, 9: 3 })
  })

  it('returns an empty object for no turns', () => {
    expect(buildTurnNumberMap([])).toEqual({})
  })
})
