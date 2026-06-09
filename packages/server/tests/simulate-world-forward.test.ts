import { describe, expect, it } from 'vitest'

import { simulateWorldForward } from '@/application/use-cases/simulate-world-forward'
import type { SimulateWorldForwardDeps } from '@/application/use-cases/simulate-world-forward'
import type { Character, CharacterRelationship, PlaceConnection } from '@/domain/entities'
import type {
  CharacterRepository,
  Clock,
  PlaceConnectionRepository,
  RelationshipRepository,
  WorldRepository,
} from '@/domain/ports'

// Unit test for SimulateWorldForward (starship P2). Pure orchestration exercised
// with in-memory fake ports that record their calls — no DB, no LLM. A 3-room line
// graph (bridge ── mess ── quarters), three NPCs on routines plus an ally pair that
// co-locates, run for 8 ticks. Asserts: final positions match each routine's target
// for the final band, setPlace persisted those, the co-located allies' valence
// drifted positive and was persisted via a single adjustValence delta, the world
// clock advanced to the right label, and an NPC with a malformed loop stays put.

const WORLD_ID = 7

// Place ids for the line graph.
const BRIDGE = 100
const MESS = 101
const QUARTERS = 102

// 8 ticks → bands cycle morning, midday, evening, night, morning, midday, evening,
// night. tick 7 (the last) is band 'night'. Each NPC's loop names where it belongs
// per band; the captain + cook share the MESS at night so they co-locate there.
const CAPTAIN_LOOP = {
  morning: { activity: 'command', place_id: BRIDGE },
  midday: { activity: 'command', place_id: BRIDGE },
  evening: { activity: 'rounds', place_id: MESS },
  night: { activity: 'supper', place_id: MESS },
}
const COOK_LOOP = {
  morning: { activity: 'prep', place_id: MESS },
  midday: { activity: 'serve', place_id: MESS },
  evening: { activity: 'clean', place_id: MESS },
  night: { activity: 'supper', place_id: MESS },
}
// The loner sleeps in quarters at night, alone — never co-located.
const LONER_LOOP = {
  morning: { activity: 'patrol', place_id: BRIDGE },
  midday: { activity: 'patrol', place_id: QUARTERS },
  evening: { activity: 'rest', place_id: QUARTERS },
  night: { activity: 'sleep', place_id: QUARTERS },
}

const CAPTAIN_ID = 1
const COOK_ID = 2
const LONER_ID = 3
const PLAYER_ID = 4
const DRIFTER_ID = 5 // NPC with a malformed daily_loop — stays at its start room.

function character(overrides: Partial<Character>): Character {
  return {
    id: 0,
    world_id: WORLD_ID,
    name: 'crew',
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
    in_transit_to_place_id: null,
    arrival_world_time: null,
    last_known_situation: null,
    aliases: null,
    daily_loop: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function relationship(overrides: Partial<CharacterRelationship>): CharacterRelationship {
  return {
    id: 0,
    world_id: WORLD_ID,
    from_character_id: 0,
    to_character_id: 0,
    kind: null,
    valence: 0,
    note: null,
    updated_at: null,
    ...overrides,
  }
}

type Fakes = {
  deps: SimulateWorldForwardDeps
  setPlaceCalls: Array<{ characterId: number; placeId: number | null }>
  adjustCalls: Array<{ relationshipId: number; delta: number }>
  setWorldTimeCalls: Array<{ worldId: number; worldTime: string }>
}

function buildFakes(roster: Character[], rels: CharacterRelationship[]): Fakes {
  const setPlaceCalls: Fakes['setPlaceCalls'] = []
  const adjustCalls: Fakes['adjustCalls'] = []
  const setWorldTimeCalls: Fakes['setWorldTimeCalls'] = []

  // A line graph: bridge ── mess ── quarters (two bidirectional corridors).
  const connections: PlaceConnection[] = [
    {
      id: 1,
      world_id: WORLD_ID,
      from_place_id: BRIDGE,
      to_place_id: MESS,
      kind: 'corridor',
      bidirectional: 1,
      created_at: null,
    },
    {
      id: 2,
      world_id: WORLD_ID,
      from_place_id: MESS,
      to_place_id: QUARTERS,
      kind: 'corridor',
      bidirectional: 1,
      created_at: null,
    },
  ]

  const characters: CharacterRepository = {
    forWorld: async () => roster,
    inPlace: async () => [],
    add: async () => ({ id: 0 }),
    setPlace: async (characterId, placeId) => {
      setPlaceCalls.push({ characterId, placeId })
    },
  }
  const placeConnections: PlaceConnectionRepository = {
    forWorld: async () => connections,
    add: async () => {},
  }
  const relationships: RelationshipRepository = {
    forWorld: async () => rels,
    upsert: async () => {},
    adjustValence: async (relationshipId, delta) => {
      adjustCalls.push({ relationshipId, delta })
    },
  }
  const worlds = {
    setWorldTime: async (worldId: number, worldTime: string) => {
      setWorldTimeCalls.push({ worldId, worldTime })
    },
  } as unknown as WorldRepository
  const clock: Clock = { now: () => new Date(0), today: () => '1970-01-01' }

  return {
    deps: { characters, placeConnections, relationships, worlds, clock },
    setPlaceCalls,
    adjustCalls,
    setWorldTimeCalls,
  }
}

describe('simulateWorldForward', () => {
  const roster: Character[] = [
    character({ id: CAPTAIN_ID, current_place_id: BRIDGE, daily_loop: JSON.stringify(CAPTAIN_LOOP) }),
    character({ id: COOK_ID, current_place_id: MESS, daily_loop: JSON.stringify(COOK_LOOP) }),
    character({ id: LONER_ID, current_place_id: BRIDGE, daily_loop: JSON.stringify(LONER_LOOP) }),
    character({ id: PLAYER_ID, is_player: 1, current_place_id: BRIDGE }),
    character({ id: DRIFTER_ID, current_place_id: QUARTERS, daily_loop: 'not json {{' }),
  ]
  const rels: CharacterRelationship[] = [
    relationship({ id: 10, from_character_id: CAPTAIN_ID, to_character_id: COOK_ID, kind: 'ally', valence: 0.2 }),
  ]

  it('moves NPCs to their routine target for the final band and persists final positions', async () => {
    const fakes = buildFakes(roster, rels)
    const result = await simulateWorldForward({ worldId: WORLD_ID, ticks: 8 }, fakes.deps)

    // tick 7 = 'night': captain + cook in MESS, loner in QUARTERS.
    const byId = new Map(result.finalPositions.map((p) => [p.characterId, p.placeId]))
    expect(byId.get(CAPTAIN_ID)).toBe(MESS)
    expect(byId.get(COOK_ID)).toBe(MESS)
    expect(byId.get(LONER_ID)).toBe(QUARTERS)

    // setPlace persisted the same final rooms (one call per NPC, not the player).
    const setById = new Map(fakes.setPlaceCalls.map((c) => [c.characterId, c.placeId]))
    expect(setById.get(CAPTAIN_ID)).toBe(MESS)
    expect(setById.get(COOK_ID)).toBe(MESS)
    expect(setById.get(LONER_ID)).toBe(QUARTERS)
    expect(fakes.setPlaceCalls).toHaveLength(4) // captain, cook, loner, drifter — not the player
  })

  it('drifts co-located allies positive and persists a single valence delta', async () => {
    const fakes = buildFakes(roster, rels)
    const result = await simulateWorldForward({ worldId: WORLD_ID, ticks: 8 }, fakes.deps)

    // Captain + cook share MESS at evening (tick 2,6) and night (tick 3,7); the
    // cook is always in MESS. Each co-located tick bonds +0.1 from 0.2.
    const drifted = result.drifted.find((d) => d.relationshipId === 10)
    expect(drifted).toBeDefined()
    expect(drifted!.valence).toBeGreaterThan(0.2)
    expect(drifted!.from).toBe(CAPTAIN_ID)
    expect(drifted!.to).toBe(COOK_ID)

    // Exactly one adjustValence call, with a positive delta = final − original.
    expect(fakes.adjustCalls).toHaveLength(1)
    expect(fakes.adjustCalls[0]!.relationshipId).toBe(10)
    expect(fakes.adjustCalls[0]!.delta).toBeCloseTo(drifted!.valence - 0.2, 6)
    expect(fakes.adjustCalls[0]!.delta).toBeGreaterThan(0)
  })

  it('advances the world clock to the label for N ticks', async () => {
    const fakes = buildFakes(roster, rels)
    await simulateWorldForward({ worldId: WORLD_ID, ticks: 8 }, fakes.deps)

    // 8 ticks → Day 3 morning (4 ticks/day; tick 8 rolls to day 3, band morning).
    expect(fakes.setWorldTimeCalls).toHaveLength(1)
    expect(fakes.setWorldTimeCalls[0]).toEqual({ worldId: WORLD_ID, worldTime: 'Day 3 — morning' })
  })

  it('keeps an NPC with a malformed daily_loop at its starting room', async () => {
    const fakes = buildFakes(roster, rels)
    const result = await simulateWorldForward({ worldId: WORLD_ID, ticks: 8 }, fakes.deps)

    const drifter = result.finalPositions.find((p) => p.characterId === DRIFTER_ID)
    expect(drifter?.placeId).toBe(QUARTERS) // never moved
    const setDrifter = fakes.setPlaceCalls.find((c) => c.characterId === DRIFTER_ID)
    expect(setDrifter?.placeId).toBe(QUARTERS)
  })

  it('excludes the player from the sim entirely', async () => {
    const fakes = buildFakes(roster, rels)
    const result = await simulateWorldForward({ worldId: WORLD_ID, ticks: 8 }, fakes.deps)

    expect(result.finalPositions.some((p) => p.characterId === PLAYER_ID)).toBe(false)
    expect(fakes.setPlaceCalls.some((c) => c.characterId === PLAYER_ID)).toBe(false)
  })
})
