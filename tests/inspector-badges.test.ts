import { describe, expect, it } from 'vitest'

import { deriveCharacterBadges, deriveSceneBadge } from '@/lib/inspector-badges'
import type { CharacterAgencyLevel } from '@/lib/world-state'

const baseChar = {
  is_player: 0 as number,
  status: 'active' as 'active' | 'inactive' | 'dead',
  agency_level: 'npc' as CharacterAgencyLevel,
  current_place_id: null as number | null,
}

describe('deriveCharacterBadges', () => {
  it('returns no badge for a plain active npc', () => {
    expect(deriveCharacterBadges(baseChar, null)).toEqual([])
  })

  it('flags inactive and dead via life status', () => {
    expect(deriveCharacterBadges({ ...baseChar, status: 'inactive' }, null)).toEqual([
      { label: 'inactive', tone: 'muted' },
    ])
    expect(deriveCharacterBadges({ ...baseChar, status: 'dead' }, null)).toEqual([
      { label: 'dead', tone: 'danger' },
    ])
  })

  it('flags presence only when in the current place', () => {
    expect(deriveCharacterBadges({ ...baseChar, current_place_id: 7 }, 7)).toEqual([
      { label: 'here', tone: 'here' },
    ])
    expect(deriveCharacterBadges({ ...baseChar, current_place_id: 7 }, 9)).toEqual([])
    expect(deriveCharacterBadges({ ...baseChar, current_place_id: 7 }, null)).toEqual([])
  })

  it('shows agency level for non-npc, hides plain npc', () => {
    expect(deriveCharacterBadges({ ...baseChar, agency_level: 'dormant' }, null)).toEqual([
      { label: 'dormant', tone: 'agency' },
    ])
    expect(deriveCharacterBadges({ ...baseChar, agency_level: 'npc' }, null)).toEqual([])
  })

  it('marks the player and never shows their agency', () => {
    expect(deriveCharacterBadges({ ...baseChar, is_player: 1, agency_level: 'local' }, null)).toEqual([
      { label: 'you', tone: 'player' },
    ])
  })

  it('orders badges player, life, presence, agency', () => {
    expect(
      deriveCharacterBadges(
        { is_player: 0, status: 'dead', agency_level: 'nearby', current_place_id: 3 },
        3,
      ),
    ).toEqual([
      { label: 'dead', tone: 'danger' },
      { label: 'here', tone: 'here' },
      { label: 'nearby', tone: 'agency' },
    ])
  })

  it('orders all four slots for a player: you, life, presence — agency suppressed', () => {
    expect(
      deriveCharacterBadges(
        { is_player: 1, status: 'dead', agency_level: 'nearby' as CharacterAgencyLevel, current_place_id: 3 },
        3,
      ),
    ).toEqual([
      { label: 'you', tone: 'player' },
      { label: 'dead', tone: 'danger' },
      { label: 'here', tone: 'here' },
    ])
  })
})

describe('deriveSceneBadge', () => {
  it('maps scene status to active/done', () => {
    expect(deriveSceneBadge({ status: 'active' })).toEqual({ label: 'active', tone: 'active' })
    expect(deriveSceneBadge({ status: 'completed' })).toEqual({ label: 'done', tone: 'muted' })
  })
})
