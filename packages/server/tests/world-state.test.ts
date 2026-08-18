import { describe, expect, it } from 'vitest'

import { worldTimeBand } from '@/lib/world-time'
import {
  applyPromotionDeltaToState,
  collectSceneTags,
  formatStateBlock,
  type Character,
  type NarratorWorldState,
} from '@/lib/world-state'

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
    expect(block).toContain('⚡ FLARING SUBTEXT')
    expect(block).toContain('burnt coffee recalls the outage')
    expect(block).toContain('rain on glass recalls the informant')
    // Regression (v0.6.x): the word "reverie" must never appear in the STATE
    // block — it was an injected label the narrator parroted into prose.
    expect(block).not.toMatch(/reverie/i)
  })
})

describe('formatStateBlock settled memorable facts', () => {
  it('keeps a completed-records finding on the player after newer spikes', () => {
    const player = {
      id: 16,
      world_id: 2,
      name: 'Andrew Osborne',
      description: null,
      is_player: 1,
      status: 'active',
      memorable_facts: [
        'Pre-assignment medical records confirm tremor was documented for the last eight months.',
        'The tremor spiked sharply in the corridor this morning.',
        'Baseline examination in Medical at 07:00 confirmed tremor as pre-arrival pattern; cleared for shift duty.',
        'Tremor spiked again sharply in the corridor near the Bunk Area.',
      ].join('\n'),
    } as never
    const block = formatStateBlock(
      baseState({
        presentCharacters: [player],
        dossier: {
          threads: [],
          clues: [
            {
              title: 'Tremor documented eight months pre-arrival',
              detail: 'Ellis confirms records show the tremor for eight months.',
              status: 'interpreted',
            },
          ],
          objectives: [
            {
              title: "Obtain Andrew's pre-assignment medical records",
              detail: 'Retrieve prior medical history.',
              status: 'completed',
            },
          ],
          resources: [],
          timeline: [],
        } as never,
      }),
    )
    expect(block).toMatch(/medical records confirm tremor/i)
    expect(block).toMatch(/cleared for shift/i)
  })
})

describe('private-belief scoping (A2)', () => {
  it('emits only the first belief, scoped to the owning NPC, and never broadcasts the rest', () => {
    const marcus = {
      id: 11, world_id: 1, name: 'Marcus', description: null, is_player: 0, status: 'active',
      agency_level: 'local', current_place_id: 1,
      private_beliefs: 'Line one.\nLine two.\nLine three.',
    } as never
    const block = formatStateBlock(baseState({ presentCharacters: [marcus] }))
    expect(block).toContain('known only to Marcus')
    expect(block).toContain('Line one.')
    expect(block).not.toContain('Line two.')
    expect(block).not.toContain('Line three.')
  })
})

describe('PRIVATE THIS TURN audience pin', () => {
  it('renders channel + audience without restating secret body', () => {
    const block = formatStateBlock(
      baseState({}),
      [],
      [],
      { byCharacter: new Map(), flaring: new Set() },
      null,
      { channel: 'whisper', audienceNames: ['Marcus'] },
    )
    expect(block).toContain('### PRIVATE THIS TURN (authoritative audience)')
    expect(block).toContain('channel: whisper')
    expect(block).toContain('audience: Marcus only')
    expect(block).toContain('Non-audience present NPCs MUST NOT react')
    expect(block).not.toContain('floorboard')
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

describe('applyPromotionDeltaToState', () => {
  function char(partial: Partial<Character> & Pick<Character, 'id' | 'name'>): Character {
    return {
      world_id: 1,
      description: null,
      is_player: 0,
      status: 'active',
      agency_level: 'npc',
      current_place_id: 1,
      in_transit_to_place_id: null,
      last_seen_turn_id: null,
      last_known_situation: null,
      recent_activity: null,
      appearance_count: 0,
      daily_loop: null,
      ...partial,
    } as Character
  }

  it('bumps appearance_count and last_seen for present non-players', () => {
    const marcus = char({ id: 2, name: 'Marcus', appearance_count: 2 })
    const player = char({ id: 1, name: 'You', is_player: 1, appearance_count: 0 })
    const state = baseState({
      presentCharacters: [player, marcus],
      knownCharacters: [player, marcus],
    })
    const next = applyPromotionDeltaToState(state, { promoted: [] }, 99)
    expect(next.presentCharacters.find((c) => c.name === 'Marcus')?.appearance_count).toBe(3)
    expect(next.presentCharacters.find((c) => c.name === 'Marcus')?.last_seen_turn_id).toBe(99)
    expect(next.presentCharacters.find((c) => c.is_player === 1)?.appearance_count).toBe(0)
  })

  it('promotes named npcs to local agency when listed', () => {
    const marcus = char({ id: 2, name: 'Marcus', appearance_count: 2, agency_level: 'npc' })
    const state = baseState({
      presentCharacters: [marcus],
      knownCharacters: [marcus],
    })
    const next = applyPromotionDeltaToState(state, { promoted: ['Marcus'] }, 10)
    expect(next.knownCharacters[0]?.agency_level).toBe('local')
  })
})
