import { describe, expect, it } from 'vitest'

import { worldTimeBand } from '@/lib/world-time'
import { collectSceneTags, formatStateBlock, type NarratorWorldState } from '@/lib/world-state'

function baseState(overrides: Partial<NarratorWorldState>): NarratorWorldState {
  return {
    worldTime: 'Day 1, 9am',
    currentScene: null,
    currentPlace: { id: 1, world_id: 1, name: 'The Tin Anchor', description: null, kind: 'bar' } as never,
    presentCharacters: [],
    knownCharacters: [],
    knownPlaces: [],
    dossier: { threads: [], clues: [], objectives: [], resources: [], timeline: [] } as never,
    occupancy: null,
    ...overrides,
  }
}

describe('collectSceneTags', () => {
  it('includes the place profile tags and active-thread relevance tags', () => {
    const state = baseState({
      dossier: {
        threads: [{ status: 'active', relevance_tags_json: '["informant","debt"]' }],
        clues: [], objectives: [], resources: [], timeline: [],
      } as never,
    })
    const tags = collectSceneTags(state)
    expect(tags).toEqual(expect.arrayContaining(['bar', 'rumor', 'informant', 'debt']))
  })

  it('skips relevance tags of non-active threads', () => {
    const state = baseState({
      dossier: {
        threads: [
          { status: 'resolved', relevance_tags_json: '["ghost"]' },
          { status: 'active', relevance_tags_json: '["live"]' },
        ],
        clues: [], objectives: [], resources: [], timeline: [],
      } as never,
    })
    const tags = collectSceneTags(state)
    expect(tags).toContain('live')
    expect(tags).not.toContain('ghost')
  })
})

describe('formatStateBlock reverie rendering', () => {
  const npc = {
    id: 7, world_id: 1, name: 'Mara', description: null, is_player: 0, status: 'active',
    agency_level: 'local', current_place_id: 1,
  } as never

  it('renders a flaring reverie distinctly and ambient ones plainly', () => {
    const block = formatStateBlock(
      baseState({ presentCharacters: [npc] }),
      [], [],
      {
        byCharacter: new Map([[7, [
          { id: 1, character_id: 7, text: 'burnt coffee recalls the outage', match_tags: ['coffee'], intensity: 0.6, is_cornerstone: 0, created_turn_id: null, last_flared_turn_id: null, world_id: 1, created_at: '' },
          { id: 2, character_id: 7, text: 'rain on glass recalls the informant', match_tags: ['rain'], intensity: 0.5, is_cornerstone: 0, created_turn_id: null, last_flared_turn_id: null, world_id: 1, created_at: '' },
        ]]]),
        flaring: new Set([1]),
      },
    )
    expect(block).toContain('⚡ REVERIE FLARING')
    expect(block).toContain('burnt coffee recalls the outage')
    expect(block).toContain('rain on glass recalls the informant')
  })
})

describe('off-scene loop continuity', () => {
  it('renders the routine line for a looped, stationary off-scene NPC', () => {
    const off = {
      id: 9, world_id: 1, name: 'Tomas', description: null, is_player: 0, status: 'active',
      agency_level: 'nearby', current_place_id: 2, in_transit_to_place_id: null,
      last_seen_turn_id: 1, last_known_situation: null, recent_activity: null,
      daily_loop: '{"morning":{"activity":"opens the shop","place":"Anchor"}}',
    } as never
    const block = formatStateBlock(
      baseState({ worldTime: 'Day 1, 9am', knownCharacters: [off], knownPlaces: [{ id: 2, name: 'Anchor' } as never] }),
    )
    expect(worldTimeBand('Day 1, 9am')).toBe('morning')
    expect(block).toContain('routine: opens the shop')
  })
})
