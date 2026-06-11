import { describe, expect, it } from 'vitest'

import type { CharacterRow, PlaceRow } from '@/lib/archivist'
import {
  charactersMatch,
  chooseLonger,
  filterAliasesAgainstName,
  findCharacterByNameOrAlias,
  freshest,
  isAmbiguousCharacterMatch,
  maxNullable,
  mergeLineBlocks,
  placesMatch,
  strongestAgencyLevel,
  strongestStatus,
} from '@/domain/services/name-resolution'

// Characterization tests for the pure name-resolution RULES extracted from
// archivist.ts (P4). These pin the deciding logic directly — the merge OUTCOMES
// (Bob/Robert, Jordana/Jordana Osborne, descriptor reveal) are also covered
// end-to-end through applyArchivistPatch in archivist.test.ts, but here we
// freeze the rule-level verdicts so the seam stays stable as the SQL wrappers
// later carve into a MergePlan use case.

function character(partial: Partial<CharacterRow> & { id: number; name: string }): CharacterRow {
  return {
    description: null,
    is_player: 0,
    current_place_id: null,
    memorable_facts: null,
    status: 'active',
    active_goal: null,
    current_attitude: null,
    observations: null,
    agency_level: 'npc',
    personal_goals: null,
    current_focus: null,
    recent_activity: null,
    private_beliefs: null,
    reveries: null,
    relationship_to_player: null,
    long_term_agenda: null,
    tool_access: null,
    appearance_count: 0,
    last_seen_turn_id: null,
    last_agent_tick_turn_id: null,
    player_notes: null,
    aliases: null,
    updated_at: '2026-01-01 00:00:00',
    ...partial,
  }
}

describe('charactersMatch', () => {
  it('matches a short name against a longer canonical name (Marcus ⊂ Marcus Reeves)', () => {
    expect(charactersMatch('Marcus', 'Marcus Reeves')).toBe(true)
    expect(charactersMatch('Jordana', 'Jordana Osborne')).toBe(true)
  })

  it('strips honorifics before matching (Dr. Vance ↔ Vance)', () => {
    expect(charactersMatch('Dr. Vance', 'Vance')).toBe(true)
  })

  it('refuses to fuse two descriptor-only names', () => {
    expect(charactersMatch('The man at the gyro van', 'The man in the canvas vest')).toBe(false)
  })

  it('refuses a single short token (< 4 chars)', () => {
    expect(charactersMatch('Jo', 'Jordana Osborne')).toBe(false)
  })
})

describe('isAmbiguousCharacterMatch', () => {
  it('flags a single bare first name that matches more than one row', () => {
    const matches = [character({ id: 1, name: 'Marcus Reeves' }), character({ id: 2, name: 'Marcus Bell' })]
    expect(isAmbiguousCharacterMatch('Marcus', matches)).toBe(true)
  })

  it('does not flag when only one row carries the token', () => {
    const matches = [character({ id: 1, name: 'Marcus Reeves' })]
    expect(isAmbiguousCharacterMatch('Marcus', matches)).toBe(false)
  })
})

describe('placesMatch', () => {
  it('matches a qualified house against its base name via PLACE_DETAIL_WORDS', () => {
    expect(placesMatch('33rd Street house - kitchen', '33rd Street house', undefined)).toBe(true)
    expect(placesMatch('33rd Street house, Spokane', '33rd Street house', undefined)).toBe(true)
  })

  it('keeps sibling "City - District" names distinct (no dash-head collapse)', () => {
    // Regression: canonicalPlaceKey once kept only the part before " - ", so
    // every "Thebes - X" district collapsed onto the first one created. The
    // player could never leave it and co-located NPCs stayed "local" forever.
    expect(placesMatch('Thebes - canal path', 'Thebes - outer path', undefined)).toBe(false)
    expect(placesMatch('Thebes - market square', 'Thebes - outer path', undefined)).toBe(false)
    expect(placesMatch('Thebes - western acacia grove', 'Thebes - outer path', undefined)).toBe(false)
  })

  it('maps a generic room key onto the current residential place', () => {
    const house: PlaceRow = {
      id: 7,
      name: '33rd Street house',
      description: "Edith's home.",
      kind: 'house',
      player_notes: null,
    }
    expect(placesMatch('Kitchen', '33rd Street house', house)).toBe(true)
  })

  it('does not map a generic room key when the current place is not residential', () => {
    const office: PlaceRow = {
      id: 8,
      name: 'Covenant Security',
      description: 'A security firm office.',
      kind: 'office',
      player_notes: null,
    }
    expect(placesMatch('Kitchen', 'Covenant Security', office)).toBe(false)
  })
})

describe('freshest (merge field freshness)', () => {
  it('prefers the more recently updated rows value when both are set', () => {
    const older = character({ id: 1, name: 'Jordana', active_goal: 'finish the ledger', updated_at: '2026-01-01 00:00:00' })
    const newer = character({ id: 2, name: 'Jordana Osborne', active_goal: 'identify the fragment', updated_at: '2026-01-01 00:00:05' })
    // target=older, source=newer: source is fresher → source value wins.
    expect(freshest(older, newer, (r) => r.active_goal)).toBe('identify the fragment')
  })

  it('non-null beats null regardless of mtime', () => {
    const a = character({ id: 1, name: 'A', active_goal: null, updated_at: '2026-01-01 00:00:09' })
    const b = character({ id: 2, name: 'B', active_goal: 'do the thing', updated_at: '2026-01-01 00:00:00' })
    expect(freshest(a, b, (r) => r.active_goal)).toBe('do the thing')
  })

  it('ties go to the target', () => {
    const t = character({ id: 1, name: 'T', current_attitude: 'curt', updated_at: '2026-01-01 00:00:00' })
    const s = character({ id: 2, name: 'S', current_attitude: 'guarded', updated_at: '2026-01-01 00:00:00' })
    expect(freshest(t, s, (r) => r.current_attitude)).toBe('curt')
  })
})

describe('findCharacterByNameOrAlias', () => {
  it('resolves a descriptor via the canonical rows aliases list', () => {
    const rows = [
      character({ id: 1, name: 'The Man at the Gyro Van', aliases: 'The Man in the Canvas Vest' }),
    ]
    expect(findCharacterByNameOrAlias(rows, 'The Man in the Canvas Vest')?.id).toBe(1)
  })

  it('returns null when neither name nor alias matches', () => {
    const rows = [character({ id: 1, name: 'Tom' })]
    expect(findCharacterByNameOrAlias(rows, 'Bran')).toBeNull()
  })
})

describe('merge scalar helpers', () => {
  it('chooseLonger keeps the longer non-empty description', () => {
    expect(chooseLonger('short', 'a much longer description')).toBe('a much longer description')
    expect(chooseLonger(null, 'only one')).toBe('only one')
  })

  it('mergeLineBlocks dedupes and concatenates line blocks', () => {
    expect(mergeLineBlocks('a\nb', 'b\nc')).toBe('a\nb\nc')
    expect(mergeLineBlocks(null, null)).toBeNull()
  })

  it('strongestStatus ranks dead > active > inactive', () => {
    expect(strongestStatus('inactive', 'dead')).toBe('dead')
    expect(strongestStatus('active', 'inactive')).toBe('active')
  })

  it('strongestAgencyLevel ranks local highest', () => {
    expect(strongestAgencyLevel('npc', 'local')).toBe('local')
    expect(strongestAgencyLevel('nearby', 'dormant')).toBe('nearby')
  })

  it('maxNullable returns the larger turn id, null-tolerant', () => {
    expect(maxNullable(5, 9)).toBe(9)
    expect(maxNullable(null, 3)).toBe(3)
    expect(maxNullable(null, null)).toBeNull()
  })

  it('filterAliasesAgainstName drops the canonical name and dedupes', () => {
    expect(filterAliasesAgainstName('Jordana\nJordana Osborne\nJordana', 'Jordana Osborne')).toBe('Jordana')
    expect(filterAliasesAgainstName(null, 'X')).toBeNull()
  })
})
