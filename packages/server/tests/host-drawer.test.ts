import { describe, expect, it } from 'vitest'

import type { Character } from '@/domain/entities'
import {
  isSeatedExtra,
  pickDrawerExtra,
  shouldSkipDescriptorMint,
} from '@/domain/services/host-drawer'

function extra(partial: Partial<Character> & Pick<Character, 'id' | 'name'>): Character {
  return {
    world_id: 1,
    description: null,
    is_player: 0,
    current_place_id: 10,
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
    in_transit_to_place_id: null,
    arrival_world_time: null,
    arrival_minutes: null,
    journey_path_json: null,
    last_known_situation: null,
    aliases: null,
    daily_loop: null,
    speech_register: null,
    refusals: JSON.stringify(['will not invent a name for a tab that has none']),
    clearance_level: 'public_crew',
    created_at: '',
    updated_at: '',
    ...partial,
  }
}

describe('host drawer extras', () => {
  it('reuses a seated extra at the same place for a descriptor name', () => {
    const nia = extra({ id: 3, name: 'Nia Brett', current_place_id: 10 })
    expect(isSeatedExtra(nia)).toBe(true)
    expect(pickDrawerExtra('the technician', 10, [nia])?.name).toBe('Nia Brett')
  })

  it('does not reuse a principal or an extra in another room', () => {
    const jordan = extra({
      id: 4,
      name: 'Jordan Lacy',
      agency_level: 'local',
      current_place_id: 10,
    })
    const nia = extra({ id: 3, name: 'Nia Brett', current_place_id: 11 })
    expect(pickDrawerExtra('the technician', 10, [jordan, nia])).toBeNull()
  })

  it('skips minting a descriptor when the world already has a drawer', () => {
    const nia = extra({ id: 3, name: 'Nia Brett' })
    expect(shouldSkipDescriptorMint('the technician', [nia])).toBe(true)
    expect(shouldSkipDescriptorMint('Innkeeper', [nia])).toBe(false)
    expect(shouldSkipDescriptorMint('the technician', [])).toBe(false)
  })
})
